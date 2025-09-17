import mongoose, { Document, Schema } from 'mongoose';

export interface IUserClaim extends Document {
  walletAddress: string;
  airdropId: mongoose.Types.ObjectId;
  claimed: boolean;
  claimTxHash?: string;
  claimDate?: Date;
  claimAmount: string;
  blockchain: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserClaimSchema: Schema = new Schema({
  walletAddress: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  airdropId: {
    type: Schema.Types.ObjectId,
    ref: 'Airdrop',
    required: true
  },
  claimed: {
    type: Boolean,
    default: false
  },
  claimTxHash: {
    type: String,
    lowercase: true
  },
  claimDate: {
    type: Date
  },
  claimAmount: {
    type: String,
    required: true
  },
  blockchain: {
    type: String,
    required: true,
    enum: ['ethereum', 'polygon', 'bsc', 'arbitrum', 'optimism'],
    lowercase: true
  }
}, {
  timestamps: true
});

UserClaimSchema.index({ walletAddress: 1, airdropId: 1 }, { unique: true });
UserClaimSchema.index({ walletAddress: 1, claimed: 1 });
UserClaimSchema.index({ blockchain: 1 });

export default mongoose.model<IUserClaim>('UserClaim', UserClaimSchema);