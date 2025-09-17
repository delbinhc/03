import mongoose, { Document, Schema } from 'mongoose';

export interface IAirdrop extends Document {
  name: string;
  tokenSymbol: string;
  tokenAddress: string;
  contractAddress: string;
  blockchain: string;
  description: string;
  totalSupply: string;
  claimableAmount: string;
  claimFunction: string;
  abi: any[];
  isActive: boolean;
  expirationDate?: Date;
  requirements: {
    minBalance?: string;
    holdingPeriod?: number;
    whitelisted?: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const AirdropSchema: Schema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  tokenSymbol: {
    type: String,
    required: true,
    uppercase: true,
    trim: true
  },
  tokenAddress: {
    type: String,
    required: true,
    lowercase: true
  },
  contractAddress: {
    type: String,
    required: true,
    lowercase: true
  },
  blockchain: {
    type: String,
    required: true,
    enum: ['ethereum', 'polygon', 'bsc', 'arbitrum', 'optimism'],
    lowercase: true
  },
  description: {
    type: String,
    required: true
  },
  totalSupply: {
    type: String,
    required: true
  },
  claimableAmount: {
    type: String,
    required: true
  },
  claimFunction: {
    type: String,
    required: true,
    default: 'claim'
  },
  abi: {
    type: [Schema.Types.Mixed],
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  expirationDate: {
    type: Date
  },
  requirements: {
    minBalance: String,
    holdingPeriod: Number,
    whitelisted: Boolean
  }
}, {
  timestamps: true
});

AirdropSchema.index({ contractAddress: 1, blockchain: 1 }, { unique: true });
AirdropSchema.index({ isActive: 1, expirationDate: 1 });
AirdropSchema.index({ blockchain: 1 });

export default mongoose.model<IAirdrop>('Airdrop', AirdropSchema);