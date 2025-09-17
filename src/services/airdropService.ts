import Airdrop, { IAirdrop } from '../models/Airdrop';
import UserClaim, { IUserClaim } from '../models/UserClaim';
import blockchainService from './blockchainService';

export interface AirdropSearchResult {
  airdrop: IAirdrop;
  eligibility: {
    eligible: boolean;
    amount?: string;
    error?: string;
  };
  userClaim?: IUserClaim;
}

export class AirdropService {
  
  async searchAirdropsForWallet(walletAddress: string): Promise<AirdropSearchResult[]> {
    try {
      // Get all active airdrops
      const activeAirdrops = await Airdrop.find({ 
        isActive: true,
        $or: [
          { expirationDate: { $gte: new Date() } },
          { expirationDate: { $exists: false } }
        ]
      });

      const results: AirdropSearchResult[] = [];

      // Check eligibility for each airdrop
      for (const airdrop of activeAirdrops) {
        try {
          // Check if user has already claimed
          const existingClaim = await UserClaim.findOne({
            walletAddress: walletAddress.toLowerCase(),
            airdropId: airdrop._id,
            claimed: true
          });

          if (existingClaim) {
            // Already claimed, skip
            continue;
          }

          // Check eligibility on blockchain
          const eligibility = await blockchainService.checkAirdropEligibility(
            airdrop.blockchain,
            airdrop.contractAddress,
            walletAddress,
            airdrop.abi
          );

          if (eligibility.eligible) {
            const userClaim = await UserClaim.findOne({
              walletAddress: walletAddress.toLowerCase(),
              airdropId: airdrop._id
            });

            results.push({
              airdrop,
              eligibility,
              userClaim: userClaim || undefined
            });
          }
        } catch (error) {
          console.error(`Error checking airdrop ${airdrop.name}:`, error);
          // Continue with next airdrop
        }
      }

      return results;
    } catch (error) {
      console.error('Error searching airdrops:', error);
      throw error;
    }
  }

  async getAirdropsByBlockchain(blockchain: string): Promise<IAirdrop[]> {
    try {
      return await Airdrop.find({ 
        blockchain: blockchain.toLowerCase(), 
        isActive: true,
        $or: [
          { expirationDate: { $gte: new Date() } },
          { expirationDate: { $exists: false } }
        ]
      }).sort({ createdAt: -1 });
    } catch (error) {
      console.error(`Error getting airdrops for ${blockchain}:`, error);
      throw error;
    }
  }

  async addAirdrop(airdropData: Partial<IAirdrop>): Promise<IAirdrop> {
    try {
      const airdrop = new Airdrop(airdropData);
      return await airdrop.save();
    } catch (error) {
      console.error('Error adding airdrop:', error);
      throw error;
    }
  }

  async claimAirdrop(
    walletAddress: string, 
    airdropId: string, 
    privateKey?: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const airdrop = await Airdrop.findById(airdropId);
      if (!airdrop) {
        return { success: false, error: 'Airdrop not found' };
      }

      // Check if already claimed
      const existingClaim = await UserClaim.findOne({
        walletAddress: walletAddress.toLowerCase(),
        airdropId: airdrop._id,
        claimed: true
      });

      if (existingClaim) {
        return { success: false, error: 'Airdrop already claimed' };
      }

      // Check eligibility
      const eligibility = await blockchainService.checkAirdropEligibility(
        airdrop.blockchain,
        airdrop.contractAddress,
        walletAddress,
        airdrop.abi
      );

      if (!eligibility.eligible) {
        return { success: false, error: 'Not eligible for this airdrop' };
      }

      // Execute claim transaction
      const claimResult = await blockchainService.executeClaimTransaction(
        airdrop.blockchain,
        airdrop.contractAddress,
        airdrop.abi,
        walletAddress,
        privateKey
      );

      if (claimResult.success && claimResult.txHash) {
        // Record the claim
        const userClaim = new UserClaim({
          walletAddress: walletAddress.toLowerCase(),
          airdropId: airdrop._id,
          claimed: true,
          claimTxHash: claimResult.txHash,
          claimDate: new Date(),
          claimAmount: eligibility.amount || '0',
          blockchain: airdrop.blockchain
        });

        await userClaim.save();
      }

      return claimResult;
    } catch (error) {
      console.error('Error claiming airdrop:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async getUserClaims(walletAddress: string): Promise<IUserClaim[]> {
    try {
      return await UserClaim.find({
        walletAddress: walletAddress.toLowerCase()
      }).populate('airdropId').sort({ createdAt: -1 });
    } catch (error) {
      console.error('Error getting user claims:', error);
      throw error;
    }
  }

  async getAirdropStats(): Promise<{
    totalAirdrops: number;
    activeAirdrops: number;
    totalClaims: number;
    blockchainStats: Record<string, number>;
  }> {
    try {
      const [totalAirdrops, activeAirdrops, totalClaims, blockchainStats] = await Promise.all([
        Airdrop.countDocuments(),
        Airdrop.countDocuments({ isActive: true }),
        UserClaim.countDocuments({ claimed: true }),
        Airdrop.aggregate([
          { $group: { _id: '$blockchain', count: { $sum: 1 } } }
        ])
      ]);

      const blockchainStatsObj: Record<string, number> = {};
      blockchainStats.forEach(stat => {
        blockchainStatsObj[stat._id] = stat.count;
      });

      return {
        totalAirdrops,
        activeAirdrops,
        totalClaims,
        blockchainStats: blockchainStatsObj
      };
    } catch (error) {
      console.error('Error getting airdrop stats:', error);
      throw error;
    }
  }
}

export default new AirdropService();