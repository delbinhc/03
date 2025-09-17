import mongoose, { Schema, Document } from 'mongoose';

export interface IVerifiedAirdrop extends Document {
  name: string;
  symbol: string;
  contractAddress: string;
  tokenAddress: string;
  blockchain: string;
  description: string;
  website?: string;
  twitter?: string;
  discord?: string;
  telegram?: string;
  startDate?: Date;
  endDate?: Date;
  claimDeadline?: Date;
  totalValue?: string;
  totalTokens?: string;
  eligibleUsers?: number;
  claimedUsers?: number;
  requirements: {
    minBalance?: string;
    snapshotDate?: Date;
    holdingPeriod?: number;
    interactions?: string[];
    whitelistOnly?: boolean;
    kyc?: boolean;
  };
  status: 'upcoming' | 'active' | 'ended' | 'paused' | 'cancelled';
  verificationLevel: 'unverified' | 'community' | 'official' | 'scam';
  sources: {
    type: 'api' | 'scraping' | 'monitoring' | 'manual';
    url: string;
    lastUpdated: Date;
    confidence: number; // 0-100
  }[];
  contractInfo: {
    verified: boolean;
    hasClaimFunction: boolean;
    owner?: string;
    deployer?: string;
    creationDate?: Date;
    lastActivity?: Date;
    auditReports?: string[];
  };
  distribution: {
    method: 'claim' | 'airdrop' | 'vesting' | 'lottery';
    claimContract?: string;
    vestingSchedule?: {
      periods: number;
      periodDuration: number; // en días
      initialRelease: number; // porcentaje
    };
  };
  socialMetrics: {
    twitterFollowers?: number;
    discordMembers?: number;
    telegramMembers?: number;
    lastSocialUpdate?: Date;
  };
  risks: {
    level: 'low' | 'medium' | 'high' | 'critical';
    factors: string[];
    warnings: string[];
  };
  tags: string[];
  metadata: {
    addedBy: 'system' | 'community' | 'admin';
    addedAt: Date;
    lastVerified: Date;
    verificationHistory: {
      date: Date;
      action: string;
      by: string;
      details?: string;
    }[];
  };
  analytics: {
    views: number;
    claims: number;
    successfulClaims: number;
    totalValueClaimed?: string;
    averageClaimValue?: string;
    topClaimers?: {
      address: string;
      amount: string;
      date: Date;
    }[];
  };
}

const VerifiedAirdropSchema: Schema = new Schema({
  name: { type: String, required: true, trim: true },
  symbol: { type: String, required: true, uppercase: true, trim: true },
  contractAddress: { type: String, required: true, unique: true, lowercase: true },
  tokenAddress: { type: String, required: true, lowercase: true },
  blockchain: { 
    type: String, 
    required: true, 
    enum: ['ethereum', 'polygon', 'bsc', 'arbitrum', 'optimism', 'avalanche', 'fantom', 'solana'],
    default: 'ethereum'
  },
  description: { type: String, required: true },
  website: { type: String, trim: true },
  twitter: { type: String, trim: true },
  discord: { type: String, trim: true },
  telegram: { type: String, trim: true },
  startDate: { type: Date },
  endDate: { type: Date },
  claimDeadline: { type: Date },
  totalValue: { type: String },
  totalTokens: { type: String },
  eligibleUsers: { type: Number, default: 0 },
  claimedUsers: { type: Number, default: 0 },
  requirements: {
    minBalance: { type: String },
    snapshotDate: { type: Date },
    holdingPeriod: { type: Number }, // días
    interactions: [{ type: String }],
    whitelistOnly: { type: Boolean, default: false },
    kyc: { type: Boolean, default: false }
  },
  status: { 
    type: String, 
    required: true,
    enum: ['upcoming', 'active', 'ended', 'paused', 'cancelled'],
    default: 'upcoming'
  },
  verificationLevel: {
    type: String,
    required: true,
    enum: ['unverified', 'community', 'official', 'scam'],
    default: 'unverified'
  },
  sources: [{
    type: { 
      type: String, 
      required: true,
      enum: ['api', 'scraping', 'monitoring', 'manual']
    },
    url: { type: String, required: true },
    lastUpdated: { type: Date, default: Date.now },
    confidence: { type: Number, min: 0, max: 100, default: 50 }
  }],
  contractInfo: {
    verified: { type: Boolean, default: false },
    hasClaimFunction: { type: Boolean, default: false },
    owner: { type: String, lowercase: true },
    deployer: { type: String, lowercase: true },
    creationDate: { type: Date },
    lastActivity: { type: Date },
    auditReports: [{ type: String }]
  },
  distribution: {
    method: {
      type: String,
      required: true,
      enum: ['claim', 'airdrop', 'vesting', 'lottery'],
      default: 'claim'
    },
    claimContract: { type: String, lowercase: true },
    vestingSchedule: {
      periods: { type: Number },
      periodDuration: { type: Number },
      initialRelease: { type: Number }
    }
  },
  socialMetrics: {
    twitterFollowers: { type: Number, default: 0 },
    discordMembers: { type: Number, default: 0 },
    telegramMembers: { type: Number, default: 0 },
    lastSocialUpdate: { type: Date }
  },
  risks: {
    level: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium'
    },
    factors: [{ type: String }],
    warnings: [{ type: String }]
  },
  tags: [{ type: String, lowercase: true }],
  metadata: {
    addedBy: {
      type: String,
      required: true,
      enum: ['system', 'community', 'admin'],
      default: 'system'
    },
    addedAt: { type: Date, default: Date.now },
    lastVerified: { type: Date, default: Date.now },
    verificationHistory: [{
      date: { type: Date, default: Date.now },
      action: { type: String, required: true },
      by: { type: String, required: true },
      details: { type: String }
    }]
  },
  analytics: {
    views: { type: Number, default: 0 },
    claims: { type: Number, default: 0 },
    successfulClaims: { type: Number, default: 0 },
    totalValueClaimed: { type: String, default: '0' },
    averageClaimValue: { type: String, default: '0' },
    topClaimers: [{
      address: { type: String, lowercase: true },
      amount: { type: String },
      date: { type: Date }
    }]
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Índices para optimizar búsquedas
VerifiedAirdropSchema.index({ contractAddress: 1 });
VerifiedAirdropSchema.index({ blockchain: 1, status: 1 });
VerifiedAirdropSchema.index({ verificationLevel: 1, status: 1 });
VerifiedAirdropSchema.index({ 'metadata.addedAt': -1 });
VerifiedAirdropSchema.index({ endDate: 1 });
VerifiedAirdropSchema.index({ tags: 1 });
VerifiedAirdropSchema.index({ 
  name: 'text', 
  symbol: 'text', 
  description: 'text' 
}, {
  weights: {
    name: 10,
    symbol: 8,
    description: 5
  }
});

// Virtuals
VerifiedAirdropSchema.virtual('isActive').get(function() {
  const now = new Date();
  return this.status === 'active' && 
         (!this.endDate || this.endDate > now) &&
         (!this.claimDeadline || this.claimDeadline > now);
});

VerifiedAirdropSchema.virtual('daysUntilExpiry').get(function() {
  if (!this.endDate && !this.claimDeadline) return null;
  
  const expiryDate = this.claimDeadline || this.endDate;
  const now = new Date();
  const diffTime = expiryDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays > 0 ? diffDays : 0;
});

VerifiedAirdropSchema.virtual('claimRate').get(function() {
  if (!this.eligibleUsers || this.eligibleUsers === 0) return 0;
  return (this.claimedUsers / this.eligibleUsers) * 100;
});

VerifiedAirdropSchema.virtual('riskScore').get(function() {
  let score = 50; // Base score
  
  // Factors that increase trust (decrease risk)
  if (this.contractInfo.verified) score -= 20;
  if (this.verificationLevel === 'official') score -= 25;
  if (this.contractInfo.auditReports && this.contractInfo.auditReports.length > 0) score -= 15;
  if (this.socialMetrics.twitterFollowers > 10000) score -= 5;
  if (this.sources.length > 2) score -= 5;
  
  // Factors that decrease trust (increase risk)
  if (this.verificationLevel === 'unverified') score += 30;
  if (!this.contractInfo.hasClaimFunction) score += 20;
  if (this.risks.level === 'high') score += 25;
  if (this.risks.level === 'critical') score += 40;
  if (!this.website) score += 10;
  
  return Math.max(0, Math.min(100, score));
});

// Middleware pre-save
VerifiedAirdropSchema.pre('save', function(next) {
  // Auto-update verification history
  if (this.isModified('verificationLevel')) {
    this.metadata.verificationHistory.push({
      date: new Date(),
      action: `Verification level changed to ${this.verificationLevel}`,
      by: 'system',
      details: `Previous level: ${this.isModified('verificationLevel')}`
    });
  }
  
  // Auto-update lastVerified
  if (this.isModified()) {
    this.metadata.lastVerified = new Date();
  }
  
  // Auto-generate tags based on content
  if (!this.tags || this.tags.length === 0) {
    this.tags = this.generateAutoTags();
  }
  
  next();
});

// Métodos del schema
VerifiedAirdropSchema.methods.generateAutoTags = function() {
  const tags = [];
  
  // Tags based on blockchain
  tags.push(this.blockchain);
  
  // Tags based on distribution method
  tags.push(this.distribution.method);
  
  // Tags based on verification level
  if (this.verificationLevel === 'official') tags.push('verified');
  if (this.contractInfo.verified) tags.push('contract-verified');
  
  // Tags based on requirements
  if (this.requirements.kyc) tags.push('kyc-required');
  if (this.requirements.whitelistOnly) tags.push('whitelist-only');
  
  // Tags based on value
  if (this.totalValue) {
    const value = parseFloat(this.totalValue.replace(/[,$]/g, ''));
    if (value > 1000000) tags.push('high-value');
    else if (value > 100000) tags.push('medium-value');
    else tags.push('low-value');
  }
  
  // Tags based on status
  tags.push(this.status);
  
  return [...new Set(tags)]; // Remove duplicates
};

VerifiedAirdropSchema.methods.incrementViews = function() {
  this.analytics.views += 1;
  return this.save();
};

VerifiedAirdropSchema.methods.recordClaim = function(address: string, amount: string, successful: boolean = true) {
  this.analytics.claims += 1;
  
  if (successful) {
    this.analytics.successfulClaims += 1;
    this.claimedUsers += 1;
    
    // Update top claimers
    this.analytics.topClaimers.push({
      address,
      amount,
      date: new Date()
    });
    
    // Keep only top 10 claimers
    this.analytics.topClaimers.sort((a: any, b: any) => parseFloat(b.amount) - parseFloat(a.amount));
    this.analytics.topClaimers = this.analytics.topClaimers.slice(0, 10);
    
    // Update total value claimed
    const currentTotal = parseFloat(this.analytics.totalValueClaimed || '0');
    const claimAmount = parseFloat(amount);
    this.analytics.totalValueClaimed = (currentTotal + claimAmount).toString();
    
    // Update average claim value
    this.analytics.averageClaimValue = (
      parseFloat(this.analytics.totalValueClaimed) / this.analytics.successfulClaims
    ).toString();
  }
  
  return this.save();
};

VerifiedAirdropSchema.methods.updateVerificationLevel = function(newLevel: string, updatedBy: string, details?: string) {
  const oldLevel = this.verificationLevel;
  this.verificationLevel = newLevel;
  
  this.metadata.verificationHistory.push({
    date: new Date(),
    action: `Verification level changed from ${oldLevel} to ${newLevel}`,
    by: updatedBy,
    details
  });
  
  return this.save();
};

VerifiedAirdropSchema.methods.addRiskWarning = function(warning: string, factor?: string) {
  if (!this.risks.warnings.includes(warning)) {
    this.risks.warnings.push(warning);
  }
  
  if (factor && !this.risks.factors.includes(factor)) {
    this.risks.factors.push(factor);
  }
  
  // Auto-adjust risk level based on number of warnings
  if (this.risks.warnings.length >= 3) {
    this.risks.level = 'high';
  } else if (this.risks.warnings.length >= 2) {
    this.risks.level = 'medium';
  }
  
  return this.save();
};

// Statics methods
VerifiedAirdropSchema.statics.findActiveAirdrops = function() {
  const now = new Date();
  return this.find({
    status: 'active',
    $and: [
      {
        $or: [
          { endDate: { $gt: now } },
          { endDate: { $exists: false } }
        ]
      },
      {
        $or: [
          { claimDeadline: { $gt: now } },
          { claimDeadline: { $exists: false } }
        ]
      }
    ]
  }).sort({ 'metadata.addedAt': -1 });
};

VerifiedAirdropSchema.statics.findByBlockchain = function(blockchain: string) {
  return this.find({ blockchain }).sort({ 'metadata.addedAt': -1 });
};

VerifiedAirdropSchema.statics.findHighValueAirdrops = function(minValue: number = 100000) {
  return this.find({
    totalValue: { $exists: true },
    status: { $in: ['active', 'upcoming'] }
  }).where('totalValue').gte(minValue.toString());
};

VerifiedAirdropSchema.statics.findByVerificationLevel = function(level: string) {
  return this.find({ verificationLevel: level }).sort({ 'metadata.addedAt': -1 });
};

VerifiedAirdropSchema.statics.searchAirdrops = function(query: string, filters: any = {}) {
  const searchQuery = {
    $text: { $search: query },
    ...filters
  };
  
  return this.find(searchQuery, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' } });
};

export const VerifiedAirdrop = mongoose.model<IVerifiedAirdrop>('VerifiedAirdrop', VerifiedAirdropSchema);