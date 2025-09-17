import { Router, Request, Response } from 'express';
import { IAirdrop } from '../models/Airdrop';
import { VerifiedAirdrop } from '../models/VerifiedAirdrop';
import airdropService from '../services/airdropService';
import blockchainService from '../services/blockchainService';
import airdropSyncService from '../services/airdropSyncService';
import contractVerificationService from '../services/contractVerificationService';

const router = Router();

// Get airdrops with advanced filtering and search
router.get('/', async (req: Request, res: Response) => {
  try {
    const { 
      blockchain, 
      status, 
      verified, 
      page = 1, 
      limit = 10,
      search 
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Construir filtros
    const filters: any = {};
    
    if (blockchain) filters.blockchain = blockchain;
    if (status) filters.status = status;
    if (verified === 'true') {
      filters.verificationLevel = { $in: ['community', 'official'] };
    }

    let airdrops;
    let total;

    // Si hay búsqueda, usar MongoDB text search
    if (search) {
      const searchQuery = {
        $text: { $search: search as string },
        ...filters
      };
      
      airdrops = await VerifiedAirdrop.find(searchQuery, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .skip(skip)
        .limit(limitNum);
        
      total = await VerifiedAirdrop.countDocuments(searchQuery);
    } else {
      // Primero intentar obtener desde airdrops verificados
      airdrops = await VerifiedAirdrop.find(filters)
        .sort({ 'metadata.addedAt': -1 })
        .skip(skip)
        .limit(limitNum);
      
      total = await VerifiedAirdrop.countDocuments(filters);

      // Si no hay suficientes resultados, complementar con airdrops legacy
      if (airdrops.length < limitNum) {
        const legacyFilters: any = {};
        if (blockchain) legacyFilters.blockchain = blockchain;
        if (status === 'active') legacyFilters.isActive = true;
        if (status === 'ended') legacyFilters.isActive = false;

        const remainingLimit = limitNum - airdrops.length;
        
        // Import Airdrop model
        const { default: AirdropModel } = await import('../models/Airdrop');
        const legacyAirdrops = await AirdropModel.find(legacyFilters)
          .sort({ createdAt: -1 })
          .limit(remainingLimit);

        // Convertir airdrops legacy al formato verificado
        const convertedAirdrops = legacyAirdrops.map((airdrop: any) => ({
          ...airdrop.toObject(),
          verificationLevel: 'unverified',
          sources: [],
          contractInfo: { verified: false, hasClaimFunction: false },
          risks: { level: 'medium', factors: [], warnings: [] },
          metadata: { addedBy: 'legacy', addedAt: airdrop.createdAt }
        }));

        airdrops.push(...convertedAirdrops);
      }
    }

    res.json({
      success: true,
      airdrops,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error: any) {
    console.error('Error fetching airdrops:', error);
    res.status(500).json({ 
      error: 'Error fetching airdrops', 
      details: error.message 
    });
  }
});

// Get airdrops for a specific wallet
router.get('/search/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const { blockchain } = req.query;

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ 
        error: 'Invalid wallet address format' 
      });
    }

    let results;
    if (blockchain && typeof blockchain === 'string') {
      // Search for airdrops on specific blockchain
      const airdrops = await airdropService.getAirdropsByBlockchain(blockchain);
      results = [];
      
      for (const airdrop of airdrops) {
        const eligibility = await blockchainService.checkAirdropEligibility(
          airdrop.blockchain,
          airdrop.contractAddress,
          walletAddress,
          airdrop.abi
        );
        
        if (eligibility.eligible) {
          results.push({ airdrop, eligibility });
        }
      }
    } else {
      // Search across all blockchains using legacy service
      results = await airdropService.searchAirdropsForWallet(walletAddress);
    }

    res.json({
      success: true,
      walletAddress,
      count: results.length,
      airdrops: results
    });
  } catch (error) {
    console.error('Error searching airdrops:', error);
    res.status(500).json({ 
      error: 'Failed to search airdrops',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get active airdrops only
router.get('/active', async (req: Request, res: Response) => {
  try {
    const airdrops = await VerifiedAirdrop.find({
      status: 'active',
      $and: [
        {
          $or: [
            { endDate: { $gt: new Date() } },
            { endDate: { $exists: false } }
          ]
        },
        {
          $or: [
            { claimDeadline: { $gt: new Date() } },
            { claimDeadline: { $exists: false } }
          ]
        }
      ]
    }).sort({ 'metadata.addedAt': -1 });
    
    res.json({
      success: true,
      count: airdrops.length,
      airdrops
    });
  } catch (error: any) {
    console.error('Error fetching active airdrops:', error);
    res.status(500).json({ 
      error: 'Error fetching active airdrops', 
      details: error.message 
    });
  }
});

// Get airdrop details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Intentar buscar en airdrops verificados primero
    let airdrop = await VerifiedAirdrop.findById(id);
    
    if (!airdrop) {
      // Buscar en airdrops legacy
      const { default: AirdropModel } = await import('../models/Airdrop');
      airdrop = await AirdropModel.findById(id);
    }

    if (!airdrop) {
      return res.status(404).json({ error: 'Airdrop not found' });
    }

    // Incrementar views si es un airdrop verificado
    if (airdrop.analytics && typeof airdrop.analytics.views === 'number') {
      airdrop.analytics.views += 1;
      await airdrop.save();
    }

    res.json({
      success: true,
      airdrop
    });
  } catch (error: any) {
    console.error('Error fetching airdrop details:', error);
    res.status(500).json({ 
      error: 'Error fetching airdrop details', 
      details: error.message 
    });
  }
});

// Check eligibility for specific airdrop
router.post('/:id/check-eligibility', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    const airdrop = await VerifiedAirdrop.findById(id);
    if (!airdrop) {
      const { default: AirdropModel } = await import('../models/Airdrop');
      const legacyAirdrop = await AirdropModel.findById(id);
      if (!legacyAirdrop) {
        return res.status(404).json({ error: 'Airdrop not found' });
      }
    }

    // Use blockchain service for eligibility check
    let isEligible = false;
    try {
      if (airdrop && airdrop.contractAddress) {
        // Simple eligibility check - in real implementation this would be more complex
        isEligible = true; // Placeholder logic
      }
    } catch (error) {
      isEligible = false;
    }

    const targetAirdrop = airdrop || await (async () => {
      const { default: AirdropModel } = await import('../models/Airdrop');
      return await AirdropModel.findById(id);
    })();

    if (!targetAirdrop) {
      return res.status(404).json({ error: 'Airdrop not found' });
    }

    res.json({
      success: true,
      eligible: isEligible,
      airdrop: {
        id: targetAirdrop._id,
        name: targetAirdrop.name,
        symbol: targetAirdrop.symbol,
        blockchain: targetAirdrop.blockchain
      }
    });
  } catch (error: any) {
    console.error('Error checking eligibility:', error);
    res.status(500).json({ 
      error: 'Error checking eligibility', 
      details: error.message 
    });
  }
});

// Claim airdrop
router.post('/:id/claim', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { walletAddress, signature } = req.body;

    if (!walletAddress || !signature) {
      return res.status(400).json({ 
        error: 'Wallet address and signature are required' 
      });
    }

    const airdrop = await VerifiedAirdrop.findById(id);
    if (!airdrop) {
      const { default: AirdropModel } = await import('../models/Airdrop');
      const legacyAirdrop = await AirdropModel.findById(id);
      if (!legacyAirdrop) {
        return res.status(404).json({ error: 'Airdrop not found' });
      }
    }

    // Simulate claim result for now
    const claimResult = {
      success: true,
      message: 'Airdrop claim initiated',
      txHash: '0x' + Math.random().toString(16).substr(2, 64)
    };

    // Register claim if successful and is verified airdrop
    if (claimResult.success && airdrop && airdrop.analytics) {
      airdrop.analytics.claims = (airdrop.analytics.claims || 0) + 1;
      airdrop.analytics.successfulClaims = (airdrop.analytics.successfulClaims || 0) + 1;
      await airdrop.save();
    }

    res.json(claimResult);
  } catch (error: any) {
    console.error('Error claiming airdrop:', error);
    res.status(500).json({ 
      error: 'Error claiming airdrop', 
      details: error.message 
    });
  }
});

// Registrar reclamación exitosa
router.post('/claim', async (req: Request, res: Response) => {
  try {
    const { airdropId, walletAddress, txHash, claimedAmount } = req.body;

    if (!airdropId || !walletAddress || !txHash) {
      return res.status(400).json({
        success: false,
        error: 'Faltan parámetros requeridos: airdropId, walletAddress, txHash'
      });
    }

    // Buscar el airdrop
    let airdrop = await VerifiedAirdrop.findById(airdropId);
    if (!airdrop) {
      const { default: AirdropModel } = await import('../models/Airdrop');
      airdrop = await AirdropModel.findById(airdropId);
    }

    if (!airdrop) {
      return res.status(404).json({
        success: false,
        error: 'Airdrop no encontrado'
      });
    }

    // Crear registro de reclamación
    const claimRecord = {
      airdropId,
      walletAddress: walletAddress.toLowerCase(),
      txHash,
      claimedAmount: claimedAmount || '0',
      claimedAt: new Date(),
      blockchain: airdrop.blockchain,
      status: 'completed'
    };

    // Actualizar estadísticas del airdrop si es posible
    if (airdrop.analytics) {
      airdrop.analytics.claims = (airdrop.analytics.claims || 0) + 1;
      airdrop.analytics.successfulClaims = (airdrop.analytics.successfulClaims || 0) + 1;
      await airdrop.save();
    }

    console.log(`✅ Reclamación registrada: ${walletAddress} reclamó ${claimedAmount || 'N/A'} tokens de ${airdrop.name} - TX: ${txHash}`);

    res.json({
      success: true,
      message: 'Reclamación registrada exitosamente',
      claim: claimRecord
    });

  } catch (error: any) {
    console.error('Error registrando reclamación:', error);
    res.status(500).json({
      success: false,
      error: 'Error registrando reclamación',
      details: error.message
    });
  }
});

// Get airdrop statistics
router.get('/stats/overview', async (req: Request, res: Response) => {
  try {
    const stats = await VerifiedAirdrop.aggregate([
      {
        $group: {
          _id: null,
          totalAirdrops: { $sum: 1 },
          activeAirdrops: {
            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
          },
          verifiedAirdrops: {
            $sum: { $cond: [{ $in: ['$verificationLevel', ['community', 'official']] }, 1, 0] }
          },
          totalValue: {
            $sum: { 
              $convert: { 
                input: '$totalValue', 
                to: 'double', 
                onError: 0 
              } 
            }
          },
          totalClaims: { $sum: '$analytics.claims' },
          successfulClaims: { $sum: '$analytics.successfulClaims' }
        }
      }
    ]);

    const blockchainStats = await VerifiedAirdrop.aggregate([
      {
        $group: {
          _id: '$blockchain',
          count: { $sum: 1 },
          activeCount: {
            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
          }
        }
      },
      { $sort: { count: -1 } }
    ]);

    res.json({
      success: true,
      stats: {
        overview: stats[0] || {
          totalAirdrops: 0,
          activeAirdrops: 0,
          verifiedAirdrops: 0,
          totalValue: 0,
          totalClaims: 0,
          successfulClaims: 0
        },
        blockchainDistribution: blockchainStats
      }
    });
  } catch (error: any) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ 
      error: 'Error fetching stats', 
      details: error.message 
    });
  }
});

// Sync real airdrops
router.post('/sync/real', async (req: Request, res: Response) => {
  try {
    if (airdropSyncService.isSyncInProgress()) {
      return res.status(409).json({ 
        error: 'Sync already in progress' 
      });
    }

    const result = await airdropSyncService.syncRealAirdrops();
    res.json({
      success: true,
      message: 'Sync completed successfully',
      result
    });
  } catch (error: any) {
    console.error('Error syncing real airdrops:', error);
    res.status(500).json({ 
      error: 'Error syncing real airdrops', 
      details: error.message 
    });
  }
});

// Get sync status
router.get('/sync/status', async (req: Request, res: Response) => {
  try {
    const lastResult = airdropSyncService.getLastSyncResult();
    const isInProgress = airdropSyncService.isSyncInProgress();

    res.json({
      success: true,
      syncInProgress: isInProgress,
      lastSync: lastResult
    });
  } catch (error: any) {
    console.error('Error getting sync status:', error);
    res.status(500).json({ 
      error: 'Error getting sync status', 
      details: error.message 
    });
  }
});

// Verify contract
router.post('/verify-contract', async (req: Request, res: Response) => {
  try {
    const { contractAddress, blockchain = 'ethereum' } = req.body;

    if (!contractAddress) {
      return res.status(400).json({ error: 'Contract address is required' });
    }

    const contractInfo = await contractVerificationService.verifyContract(
      contractAddress,
      blockchain
    );

    res.json({
      success: true,
      contractInfo
    });
  } catch (error: any) {
    console.error('Error verifying contract:', error);
    res.status(500).json({ 
      error: 'Error verifying contract', 
      details: error.message 
    });
  }
});

// Get user's claim history
router.get('/claims/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ 
        error: 'Invalid wallet address format' 
      });
    }

    const claims = await airdropService.getUserClaims?.(walletAddress) || [];
    
    res.json({
      success: true,
      walletAddress,
      count: claims.length,
      claims
    });
  } catch (error) {
    console.error('Error getting user claims:', error);
    res.status(500).json({ 
      error: 'Failed to get user claims',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;