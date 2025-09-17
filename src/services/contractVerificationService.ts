import axios from 'axios';
import { ethers } from 'ethers';

interface ContractInfo {
  address: string;
  isValid: boolean;
  isToken: boolean;
  name?: string;
  symbol?: string;
  decimals?: number;
  totalSupply?: string;
  isAirdropContract?: boolean;
  hasClaimFunction?: boolean;
  owner?: string;
  blockchain: string;
  lastActivity?: Date;
  verified: boolean;
}

interface BlockchainConfig {
  name: string;
  rpc: string;
  explorer: string;
  apiKey?: string;
  chainId: number;
}

export class ContractVerificationService {
  private blockchainConfigs: Map<string, BlockchainConfig> = new Map([
    ['ethereum', {
      name: 'Ethereum',
      rpc: 'https://eth-mainnet.alchemyapi.io/v2/' + (process.env.ALCHEMY_API_KEY || 'demo'),
      explorer: 'https://api.etherscan.io/api',
      apiKey: process.env.ETHERSCAN_API_KEY,
      chainId: 1
    }],
    ['polygon', {
      name: 'Polygon',
      rpc: 'https://polygon-mainnet.alchemyapi.io/v2/' + (process.env.ALCHEMY_API_KEY || 'demo'),
      explorer: 'https://api.polygonscan.com/api',
      apiKey: process.env.POLYGONSCAN_API_KEY,
      chainId: 137
    }],
    ['bsc', {
      name: 'BSC',
      rpc: 'https://bsc-dataseed.binance.org/',
      explorer: 'https://api.bscscan.com/api',
      apiKey: process.env.BSCSCAN_API_KEY,
      chainId: 56
    }],
    ['arbitrum', {
      name: 'Arbitrum',
      rpc: 'https://arb-mainnet.alchemyapi.io/v2/' + (process.env.ALCHEMY_API_KEY || 'demo'),
      explorer: 'https://api.arbiscan.io/api',
      apiKey: process.env.ARBISCAN_API_KEY,
      chainId: 42161
    }]
  ]);

  private providers: Map<string, ethers.JsonRpcProvider> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    for (const [blockchain, config] of this.blockchainConfigs) {
      try {
        const provider = new ethers.JsonRpcProvider(config.rpc);
        this.providers.set(blockchain, provider);
        console.log(`✅ Provider inicializado para ${config.name}`);
      } catch (error) {
        console.error(`❌ Error inicializando provider para ${blockchain}:`, error);
      }
    }
  }

  /**
   * Verifica un contrato completo
   */
  async verifyContract(address: string, blockchain: string = 'ethereum'): Promise<ContractInfo> {
    try {
      console.log(`🔍 Verificando contrato ${address} en ${blockchain}...`);

      const contractInfo: ContractInfo = {
        address,
        blockchain,
        isValid: false,
        isToken: false,
        verified: false
      };

      // 1. Verificar que la dirección es válida
      if (!this.isValidAddress(address)) {
        return contractInfo;
      }

      // 2. Verificar que existe código en la dirección
      const hasCode = await this.hasContractCode(address, blockchain);
      if (!hasCode) {
        return contractInfo;
      }

      contractInfo.isValid = true;

      // 3. Verificar información del explorador
      const explorerInfo = await this.getExplorerInfo(address, blockchain);
      if (explorerInfo) {
        contractInfo.verified = explorerInfo.verified;
      }

      // 4. Verificar si es un token ERC-20
      const tokenInfo = await this.getTokenInfo(address, blockchain);
      if (tokenInfo) {
        contractInfo.isToken = true;
        contractInfo.name = tokenInfo.name;
        contractInfo.symbol = tokenInfo.symbol;
        contractInfo.decimals = tokenInfo.decimals;
        contractInfo.totalSupply = tokenInfo.totalSupply;
      }

      // 5. Verificar si es un contrato de airdrop
      const airdropInfo = await this.checkAirdropFunctions(address, blockchain);
      contractInfo.isAirdropContract = airdropInfo.isAirdropContract;
      contractInfo.hasClaimFunction = airdropInfo.hasClaimFunction;

      // 6. Obtener información del propietario
      contractInfo.owner = await this.getContractOwner(address, blockchain);

      // 7. Verificar actividad reciente
      contractInfo.lastActivity = await this.getLastActivity(address, blockchain);

      console.log(`✅ Contrato verificado: ${JSON.stringify(contractInfo, null, 2)}`);
      return contractInfo;

    } catch (error) {
      console.error(`❌ Error verificando contrato ${address}:`, error);
      return {
        address,
        blockchain,
        isValid: false,
        isToken: false,
        verified: false
      };
    }
  }

  /**
   * Verifica si una dirección es válida
   */
  private isValidAddress(address: string): boolean {
    try {
      return ethers.isAddress(address);
    } catch {
      return false;
    }
  }

  /**
   * Verifica si hay código en la dirección
   */
  private async hasContractCode(address: string, blockchain: string): Promise<boolean> {
    try {
      const provider = this.providers.get(blockchain);
      if (!provider) return false;

      const code = await provider.getCode(address);
      return code !== '0x';
    } catch (error) {
      console.error(`Error checking contract code:`, error);
      return false;
    }
  }

  /**
   * Obtiene información del explorador de blockchain
   */
  private async getExplorerInfo(address: string, blockchain: string): Promise<any> {
    try {
      const config = this.blockchainConfigs.get(blockchain);
      if (!config || !config.apiKey) return null;

      const response = await axios.get(config.explorer, {
        params: {
          module: 'contract',
          action: 'getsourcecode',
          address: address,
          apikey: config.apiKey
        }
      });

      if (response.data.status === '1' && response.data.result[0]) {
        const result = response.data.result[0];
        return {
          verified: result.SourceCode !== '',
          contractName: result.ContractName,
          compilerVersion: result.CompilerVersion,
          sourceCode: result.SourceCode
        };
      }

      return null;
    } catch (error) {
      console.error(`Error getting explorer info:`, error);
      return null;
    }
  }

  /**
   * Obtiene información del token ERC-20
   */
  private async getTokenInfo(address: string, blockchain: string): Promise<any> {
    try {
      const provider = this.providers.get(blockchain);
      if (!provider) return null;

      // ABI mínimo para ERC-20
      const erc20ABI = [
        'function name() view returns (string)',
        'function symbol() view returns (string)',
        'function decimals() view returns (uint8)',
        'function totalSupply() view returns (uint256)'
      ];

      const contract = new ethers.Contract(address, erc20ABI, provider);

      const [name, symbol, decimals, totalSupply] = await Promise.allSettled([
        contract.name(),
        contract.symbol(),
        contract.decimals(),
        contract.totalSupply()
      ]);

      // Si al menos name y symbol funcionan, es un token
      if (name.status === 'fulfilled' && symbol.status === 'fulfilled') {
        return {
          name: name.value,
          symbol: symbol.value,
          decimals: decimals.status === 'fulfilled' ? Number(decimals.value) : 18,
          totalSupply: totalSupply.status === 'fulfilled' ? totalSupply.value.toString() : '0'
        };
      }

      return null;
    } catch (error) {
      console.error(`Error getting token info:`, error);
      return null;
    }
  }

  /**
   * Verifica funciones de airdrop
   */
  private async checkAirdropFunctions(address: string, blockchain: string): Promise<{isAirdropContract: boolean, hasClaimFunction: boolean}> {
    try {
      const provider = this.providers.get(blockchain);
      if (!provider) return { isAirdropContract: false, hasClaimFunction: false };

      // ABIs comunes para airdrops
      const airdropABI = [
        'function claim() public',
        'function claim(address) public',
        'function claimTokens() public',
        'function claimAirdrop() public',
        'function isClaimed(address) view returns (bool)',
        'function canClaim(address) view returns (bool)'
      ];

      const contract = new ethers.Contract(address, airdropABI, provider);

      let hasClaimFunction = false;
      let isAirdropContract = false;

      // Verificar funciones claim
      const claimMethods = ['claim', 'claimTokens', 'claimAirdrop'];
      for (const method of claimMethods) {
        try {
          // Intentar obtener la función (no ejecutarla)
          if (contract.interface.getFunction(method)) {
            hasClaimFunction = true;
            break;
          }
        } catch {
          // La función no existe
        }
      }

      // Verificar funciones de verificación
      const checkMethods = ['isClaimed', 'canClaim'];
      for (const method of checkMethods) {
        try {
          if (contract.interface.getFunction(method)) {
            isAirdropContract = true;
            break;
          }
        } catch {
          // La función no existe
        }
      }

      return { isAirdropContract, hasClaimFunction };
    } catch (error) {
      console.error(`Error checking airdrop functions:`, error);
      return { isAirdropContract: false, hasClaimFunction: false };
    }
  }

  /**
   * Obtiene el propietario del contrato
   */
  private async getContractOwner(address: string, blockchain: string): Promise<string | undefined> {
    try {
      const provider = this.providers.get(blockchain);
      if (!provider) return undefined;

      const ownerABI = [
        'function owner() view returns (address)',
        'function getOwner() view returns (address)'
      ];

      const contract = new ethers.Contract(address, ownerABI, provider);

      try {
        return await contract.owner();
      } catch {
        try {
          return await contract.getOwner();
        } catch {
          return undefined;
        }
      }
    } catch (error) {
      console.error(`Error getting contract owner:`, error);
      return undefined;
    }
  }

  /**
   * Obtiene la última actividad del contrato
   */
  private async getLastActivity(address: string, blockchain: string): Promise<Date | undefined> {
    try {
      const config = this.blockchainConfigs.get(blockchain);
      if (!config || !config.apiKey) return undefined;

      const response = await axios.get(config.explorer, {
        params: {
          module: 'account',
          action: 'txlist',
          address: address,
          startblock: 0,
          endblock: 99999999,
          page: 1,
          offset: 1,
          sort: 'desc',
          apikey: config.apiKey
        }
      });

      if (response.data.status === '1' && response.data.result.length > 0) {
        const lastTx = response.data.result[0];
        return new Date(parseInt(lastTx.timeStamp) * 1000);
      }

      return undefined;
    } catch (error) {
      console.error(`Error getting last activity:`, error);
      return undefined;
    }
  }

  /**
   * Verifica múltiples contratos en lote
   */
  async verifyMultipleContracts(addresses: string[], blockchain: string = 'ethereum'): Promise<ContractInfo[]> {
    console.log(`🔄 Verificando ${addresses.length} contratos en lote...`);
    
    const results: ContractInfo[] = [];
    const batchSize = 5; // Limitar la concurrencia para evitar rate limits

    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);
      const batchPromises = batch.map(address => this.verifyContract(address, blockchain));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Pequeña pausa entre lotes para evitar rate limits
      if (i + batchSize < addresses.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`✅ Verificación en lote completada: ${results.length} contratos procesados`);
    return results;
  }

  /**
   * Verifica si un airdrop está activo
   */
  async isAirdropActive(address: string, blockchain: string = 'ethereum'): Promise<boolean> {
    try {
      const contractInfo = await this.verifyContract(address, blockchain);
      
      // Criterios para considerar un airdrop activo:
      // 1. El contrato debe ser válido
      // 2. Debe tener funciones de claim
      // 3. Debe haber actividad reciente (últimos 30 días)
      
      if (!contractInfo.isValid || !contractInfo.hasClaimFunction) {
        return false;
      }

      if (contractInfo.lastActivity) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return contractInfo.lastActivity > thirtyDaysAgo;
      }

      return true; // Si no podemos verificar actividad, asumimos que está activo
    } catch (error) {
      console.error(`Error checking if airdrop is active:`, error);
      return false;
    }
  }
}

export default new ContractVerificationService();