import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import blockchainService from '../services/blockchainService';

const router = Router();

// Get wallet balance for a specific blockchain
router.get('/balance/:blockchain/:address', async (req: Request, res: Response) => {
  try {
    const { blockchain, address } = req.params;
    
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ 
        error: 'Invalid wallet address format' 
      });
    }

    const supportedBlockchains = blockchainService.getSupportedBlockchains();
    if (!supportedBlockchains.includes(blockchain.toLowerCase())) {
      return res.status(400).json({ 
        error: 'Unsupported blockchain',
        supportedBlockchains
      });
    }

    const balance = await blockchainService.getBalance(blockchain, address);
    
    res.json({
      success: true,
      blockchain,
      address,
      balance: balance + ' ETH' // This will be the native token of the blockchain
    });
  } catch (error) {
    console.error('Error getting wallet balance:', error);
    res.status(500).json({ 
      error: 'Failed to get wallet balance',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get token balance for a specific token on a blockchain
router.get('/token-balance/:blockchain/:tokenAddress/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { blockchain, tokenAddress, walletAddress } = req.params;
    
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress) || !/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
      return res.status(400).json({ 
        error: 'Invalid address format' 
      });
    }

    const supportedBlockchains = blockchainService.getSupportedBlockchains();
    if (!supportedBlockchains.includes(blockchain.toLowerCase())) {
      return res.status(400).json({ 
        error: 'Unsupported blockchain',
        supportedBlockchains
      });
    }

    const balance = await blockchainService.getTokenBalance(blockchain, tokenAddress, walletAddress);
    
    res.json({
      success: true,
      blockchain,
      tokenAddress,
      walletAddress,
      balance
    });
  } catch (error) {
    console.error('Error getting token balance:', error);
    res.status(500).json({ 
      error: 'Failed to get token balance',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get supported blockchains
router.get('/blockchains', (req: Request, res: Response) => {
  try {
    const blockchains = blockchainService.getSupportedBlockchains();
    const blockchainDetails = blockchains.map(blockchain => {
      const config = blockchainService.getBlockchainConfig(blockchain);
      return {
        id: blockchain,
        name: config?.name || blockchain,
        chainId: config?.chainId,
        rpcConfigured: !!config?.rpcUrl
      };
    });

    res.json({
      success: true,
      count: blockchains.length,
      blockchains: blockchainDetails
    });
  } catch (error) {
    console.error('Error getting supported blockchains:', error);
    res.status(500).json({ 
      error: 'Failed to get supported blockchains',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Validate wallet address
router.post('/validate', (req: Request, res: Response) => {
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({ 
        error: 'Address is required' 
      });
    }

    const isValid = /^0x[a-fA-F0-9]{40}$/.test(address);
    
    res.json({
      success: true,
      address,
      isValid,
      format: isValid ? 'Valid Ethereum address format' : 'Invalid address format'
    });
  } catch (error) {
    console.error('Error validating address:', error);
    res.status(500).json({ 
      error: 'Failed to validate address',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Verificar elegibilidad de wallet para airdrop
router.post('/check', async (req: Request, res: Response) => {
  try {
    const { address, contractAddress, blockchain } = req.body;

    // Validar parámetros
    if (!address || !contractAddress || !blockchain) {
      return res.status(400).json({
        success: false,
        error: 'Faltan parámetros requeridos: address, contractAddress, blockchain'
      });
    }

    // Validar dirección de wallet
    if (!ethers.isAddress(address)) {
      return res.status(400).json({
        success: false,
        error: 'Dirección de wallet inválida'
      });
    }

    // Validar dirección de contrato
    if (!ethers.isAddress(contractAddress)) {
      return res.status(400).json({
        success: false,
        error: 'Dirección de contrato inválida'
      });
    }

    console.log(`Verificando elegibilidad para ${address} en contrato ${contractAddress}`);

    // Obtener provider según blockchain
    const provider = getProvider(blockchain);
    if (!provider) {
      return res.status(400).json({
        success: false,
        error: 'Blockchain no soportado'
      });
    }

    // ABI básico para verificar elegibilidad
    const airdropABI = [
      "function claimed(address) external view returns (bool)",
      "function balanceOf(address) external view returns (uint256)",
      "function allowlist(address) external view returns (bool)",
      "function claimableAmount(address) external view returns (uint256)",
      "function canClaim(address) external view returns (bool)"
    ];

    const contract = new ethers.Contract(contractAddress, airdropABI, provider);

    // Verificar diferentes criterios de elegibilidad
    let eligible = false;
    let claimableAmount = "0";
    let alreadyClaimed = false;
    let reason = "";

    try {
      // Verificar si ya reclamó
      try {
        alreadyClaimed = await contract.claimed(address);
        if (alreadyClaimed) {
          reason = "Ya se reclamó este airdrop";
          return res.json({
            success: true,
            eligible: false,
            alreadyClaimed: true,
            reason
          });
        }
      } catch (error) {
        // Continuar si no existe esta función
      }

      // Verificar si está en allowlist
      try {
        const isAllowlisted = await contract.allowlist(address);
        if (isAllowlisted) {
          eligible = true;
          reason = "Dirección está en la allowlist";
        }
      } catch (error) {
        // Continuar si no existe esta función
      }

      // Verificar cantidad reclamable
      try {
        const amount = await contract.claimableAmount(address);
        if (amount > 0) {
          eligible = true;
          claimableAmount = amount.toString();
          reason = "Tiene cantidad reclamable";
        }
      } catch (error) {
        // Continuar si no existe esta función
      }

      // Verificar función canClaim
      try {
        const canClaim = await contract.canClaim(address);
        if (canClaim) {
          eligible = true;
          reason = "Función canClaim retorna true";
        }
      } catch (error) {
        // Continuar si no existe esta función
      }

      // Verificar balance del contrato
      try {
        const balance = await contract.balanceOf(address);
        if (balance > 0) {
          eligible = true;
          claimableAmount = balance.toString();
          reason = "Tiene balance en el contrato";
        }
      } catch (error) {
        // Continuar si no existe esta función
      }

      // Si no se pudo verificar eligibilidad con ningún método
      if (!eligible && reason === "") {
        reason = "No se pudo verificar elegibilidad en este contrato";
      }

      // Log del resultado
      console.log(`Elegibilidad verificada: ${address} - ${eligible ? 'ELEGIBLE' : 'NO ELEGIBLE'} - ${reason}`);

      res.json({
        success: true,
        eligible,
        alreadyClaimed,
        claimableAmount,
        reason,
        metadata: {
          contractAddress,
          blockchain,
          checkedAt: new Date().toISOString()
        }
      });

    } catch (error: any) {
      console.error('Error verificando elegibilidad en contrato:', error);
      res.status(500).json({
        success: false,
        error: 'Error verificando elegibilidad en el contrato',
        details: error.message
      });
    }

  } catch (error: any) {
    console.error('Error en verificación de elegibilidad:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      details: error.message
    });
  }
});

// Obtener información de la wallet
router.get('/info/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { blockchain = 'ethereum' } = req.query;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({
        success: false,
        error: 'Dirección de wallet inválida'
      });
    }

    const provider = getProvider(blockchain as string);
    if (!provider) {
      return res.status(400).json({
        success: false,
        error: 'Blockchain no soportado'
      });
    }

    // Obtener información básica de la wallet
    const [balance, txCount, code] = await Promise.all([
      provider.getBalance(address),
      provider.getTransactionCount(address),
      provider.getCode(address)
    ]);

    const isContract = code !== '0x';

    res.json({
      success: true,
      wallet: {
        address,
        balance: ethers.formatEther(balance),
        transactionCount: txCount,
        isContract,
        blockchain,
        checkedAt: new Date().toISOString()
      }
    });

  } catch (error: any) {
    console.error('Error obteniendo información de wallet:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo información de wallet',
      details: error.message
    });
  }
});

// Obtener provider según blockchain
function getProvider(blockchain: string): ethers.JsonRpcProvider | null {
  const providers = {
    ethereum: new ethers.JsonRpcProvider('https://eth.llamarpc.com'),
    polygon: new ethers.JsonRpcProvider('https://polygon.llamarpc.com'),
    bsc: new ethers.JsonRpcProvider('https://bsc.meowrpc.com'),
    arbitrum: new ethers.JsonRpcProvider('https://arbitrum.llamarpc.com'),
    optimism: new ethers.JsonRpcProvider('https://optimism.llamarpc.com')
  };

  return providers[blockchain.toLowerCase() as keyof typeof providers] || null;
}

export default router;