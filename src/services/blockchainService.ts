import { ethers } from 'ethers';
import Web3 from 'web3';

interface BlockchainConfig {
  rpcUrl: string;
  chainId: number;
  name: string;
  explorerApi: string;
  explorerApiKey?: string;
}

export class BlockchainService {
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();
  private web3Instances: Map<string, Web3> = new Map();

  private blockchainConfigs: Record<string, BlockchainConfig> = {
    ethereum: {
      rpcUrl: process.env.ETHEREUM_RPC_URL || '',
      chainId: 1,
      name: 'Ethereum',
      explorerApi: 'https://api.etherscan.io/api',
      explorerApiKey: process.env.ETHERSCAN_API_KEY
    },
    polygon: {
      rpcUrl: process.env.POLYGON_RPC_URL || '',
      chainId: 137,
      name: 'Polygon',
      explorerApi: 'https://api.polygonscan.com/api',
      explorerApiKey: process.env.POLYGONSCAN_API_KEY
    },
    bsc: {
      rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/',
      chainId: 56,
      name: 'BSC',
      explorerApi: 'https://api.bscscan.com/api',
      explorerApiKey: process.env.BSCSCAN_API_KEY
    },
    arbitrum: {
      rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      chainId: 42161,
      name: 'Arbitrum',
      explorerApi: 'https://api.arbiscan.io/api',
      explorerApiKey: ''
    },
    optimism: {
      rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
      chainId: 10,
      name: 'Optimism',
      explorerApi: 'https://api-optimistic.etherscan.io/api',
      explorerApiKey: ''
    }
  };

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders() {
    for (const [blockchain, config] of Object.entries(this.blockchainConfigs)) {
      if (config.rpcUrl) {
        // Initialize ethers provider
        const provider = new ethers.JsonRpcProvider(config.rpcUrl);
        this.providers.set(blockchain, provider);

        // Initialize Web3 instance
        const web3 = new Web3(config.rpcUrl);
        this.web3Instances.set(blockchain, web3);
      }
    }
  }

  public getProvider(blockchain: string): ethers.JsonRpcProvider | undefined {
    return this.providers.get(blockchain);
  }

  public getWeb3(blockchain: string): Web3 | undefined {
    return this.web3Instances.get(blockchain);
  }

  public async getBalance(blockchain: string, address: string): Promise<string> {
    const provider = this.getProvider(blockchain);
    if (!provider) {
      throw new Error(`Provider not found for blockchain: ${blockchain}`);
    }

    try {
      const balance = await provider.getBalance(address);
      return ethers.formatEther(balance);
    } catch (error) {
      console.error(`Error getting balance for ${address} on ${blockchain}:`, error);
      throw error;
    }
  }

  public async getTokenBalance(
    blockchain: string, 
    tokenAddress: string, 
    walletAddress: string
  ): Promise<string> {
    const provider = this.getProvider(blockchain);
    if (!provider) {
      throw new Error(`Provider not found for blockchain: ${blockchain}`);
    }

    try {
      // ERC-20 balanceOf function ABI
      const erc20Abi = [
        "function balanceOf(address owner) view returns (uint256)",
        "function decimals() view returns (uint8)"
      ];

      const contract = new ethers.Contract(tokenAddress, erc20Abi, provider);
      const [balance, decimals] = await Promise.all([
        contract.balanceOf(walletAddress),
        contract.decimals()
      ]);

      return ethers.formatUnits(balance, decimals);
    } catch (error) {
      console.error(`Error getting token balance:`, error);
      throw error;
    }
  }

  public async checkAirdropEligibility(
    blockchain: string,
    contractAddress: string,
    walletAddress: string,
    abi: any[]
  ): Promise<{ eligible: boolean; amount?: string; error?: string }> {
    const provider = this.getProvider(blockchain);
    if (!provider) {
      throw new Error(`Provider not found for blockchain: ${blockchain}`);
    }

    try {
      const contract = new ethers.Contract(contractAddress, abi, provider);
      
      // Try common airdrop check function names
      const checkFunctions = ['claimableTokens', 'getClaimableAmount', 'checkClaim', 'canClaim'];
      
      for (const funcName of checkFunctions) {
        try {
          if (contract[funcName]) {
            const result = await contract[funcName](walletAddress);
            
            if (result && result.toString() !== '0') {
              return {
                eligible: true,
                amount: result.toString()
              };
            }
          }
        } catch (funcError) {
          // Continue to next function if this one fails
          continue;
        }
      }

      return { eligible: false };
    } catch (error) {
      console.error(`Error checking airdrop eligibility:`, error);
      return { 
        eligible: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  public async executeClaimTransaction(
    blockchain: string,
    contractAddress: string,
    abi: any[],
    walletAddress: string,
    privateKey?: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const provider = this.getProvider(blockchain);
    if (!provider || !privateKey) {
      throw new Error('Provider or private key not available');
    }

    try {
      const wallet = new ethers.Wallet(privateKey, provider);
      const contract = new ethers.Contract(contractAddress, abi, wallet);

      // Try common claim function names
      const claimFunctions = ['claim', 'claimTokens', 'claimAirdrop'];
      
      for (const funcName of claimFunctions) {
        try {
          if (contract[funcName]) {
            const tx = await contract[funcName]();
            const receipt = await tx.wait();
            
            return {
              success: true,
              txHash: receipt.hash
            };
          }
        } catch (funcError) {
          continue;
        }
      }

      return {
        success: false,
        error: 'No valid claim function found'
      };
    } catch (error) {
      console.error(`Error executing claim transaction:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  public getBlockchainConfig(blockchain: string): BlockchainConfig | undefined {
    return this.blockchainConfigs[blockchain];
  }

  public getSupportedBlockchains(): string[] {
    return Object.keys(this.blockchainConfigs);
  }
}

export default new BlockchainService();