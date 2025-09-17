import realAirdropService from './realAirdropService';
import contractVerificationService from './contractVerificationService';
import blockchainMonitoringService from './blockchainMonitoringService';
import { VerifiedAirdrop, IVerifiedAirdrop } from '../models/VerifiedAirdrop';
import { IAirdrop } from '../models/Airdrop';

interface SyncResult {
  newAirdrops: number;
  updatedAirdrops: number;
  verifiedContracts: number;
  errors: string[];
  lastSync: Date;
}

export class AirdropSyncService {
  private isSyncing: boolean = false;
  private lastSyncResult: SyncResult | null = null;

  constructor() {
    this.setupEventListeners();
  }

  /**
   * Sincronización principal de airdrops reales
   */
  async syncRealAirdrops(): Promise<SyncResult> {
    if (this.isSyncing) {
      throw new Error('Ya hay una sincronización en progreso');
    }

    console.log('🚀 Iniciando sincronización de airdrops reales...');
    this.isSyncing = true;

    const result: SyncResult = {
      newAirdrops: 0,
      updatedAirdrops: 0,
      verifiedContracts: 0,
      errors: [],
      lastSync: new Date()
    };

    try {
      // Paso 1: Obtener airdrops desde múltiples fuentes
      console.log('📥 Obteniendo airdrops desde fuentes externas...');
      const realAirdrops = await realAirdropService.fetchRealAirdrops();
      console.log(`✅ Obtenidos ${realAirdrops.length} airdrops desde fuentes externas`);

      // Paso 2: Verificar contratos para cada airdrop
      console.log('🔍 Verificando contratos...');
      for (const airdropData of realAirdrops) {
        try {
          await this.processAirdropData(airdropData, result);
        } catch (error: any) {
          console.error(`❌ Error procesando airdrop ${airdropData.name}:`, error);
          result.errors.push(`Error procesando ${airdropData.name}: ${error.message}`);
        }
      }

      // Paso 3: Actualizar airdrops existentes
      console.log('🔄 Actualizando airdrops existentes...');
      await this.updateExistingAirdrops(result);

      // Paso 4: Limpiar datos obsoletos
      console.log('🧹 Limpiando datos obsoletos...');
      await this.cleanupObsoleteData();

      // Paso 5: Actualizar estadísticas
      console.log('📊 Actualizando estadísticas...');
      await this.updateStatistics();

      this.lastSyncResult = result;
      console.log('✅ Sincronización completada:', result);

    } catch (error: any) {
      console.error('❌ Error general en sincronización:', error);
      result.errors.push(`Error general: ${error.message}`);
    } finally {
      this.isSyncing = false;
    }

    return result;
  }

  /**
   * Procesa datos de un airdrop individual
   */
  private async processAirdropData(airdropData: any, result: SyncResult): Promise<void> {
    try {
      // Verificar si el airdrop ya existe
      let existingAirdrop = await VerifiedAirdrop.findOne({
        $or: [
          { contractAddress: airdropData.contractAddress },
          { tokenAddress: airdropData.tokenAddress },
          { name: airdropData.name, symbol: airdropData.symbol }
        ]
      });

      if (existingAirdrop) {
        // Actualizar airdrop existente
        await this.updateExistingAirdrop(existingAirdrop, airdropData);
        result.updatedAirdrops++;
        console.log(`🔄 Actualizado: ${airdropData.name}`);
      } else {
        // Crear nuevo airdrop
        const newAirdrop = await this.createNewVerifiedAirdrop(airdropData);
        if (newAirdrop) {
          result.newAirdrops++;
          console.log(`🆕 Creado: ${airdropData.name}`);
        }
      }

      // Verificar contrato si existe dirección
      if (airdropData.contractAddress) {
        await this.verifyAndUpdateContract(airdropData.contractAddress, airdropData.blockchain);
        result.verifiedContracts++;
      }

    } catch (error: any) {
      console.error(`Error procesando airdrop ${airdropData.name}:`, error);
      throw error;
    }
  }

  /**
   * Crea un nuevo airdrop verificado
   */
  private async createNewVerifiedAirdrop(airdropData: any): Promise<IVerifiedAirdrop | null> {
    try {
      // Determinar nivel de verificación inicial
      let verificationLevel = 'unverified';
      let riskLevel = 'medium';

      // Si viene de fuentes confiables, aumentar nivel
      if (['coingecko', 'known-defi'].includes(airdropData.source)) {
        verificationLevel = 'community';
        riskLevel = 'low';
      }

      const newAirdrop = new VerifiedAirdrop({
        name: airdropData.name,
        symbol: airdropData.symbol,
        contractAddress: airdropData.contractAddress || '',
        tokenAddress: airdropData.tokenAddress || airdropData.contractAddress || '',
        blockchain: airdropData.blockchain || 'ethereum',
        description: airdropData.description || `${airdropData.name} token airdrop`,
        website: airdropData.website,
        twitter: airdropData.twitter,
        endDate: airdropData.endDate ? new Date(airdropData.endDate) : undefined,
        totalValue: airdropData.totalValue,
        status: airdropData.status || 'active',
        verificationLevel,
        sources: [{
          type: this.mapSourceType(airdropData.source),
          url: airdropData.website || 'https://unknown.com',
          lastUpdated: new Date(),
          confidence: this.calculateSourceConfidence(airdropData.source)
        }],
        requirements: {
          whitelistOnly: false,
          kyc: false
        },
        distribution: {
          method: 'claim'
        },
        risks: {
          level: riskLevel,
          factors: [],
          warnings: []
        },
        metadata: {
          addedBy: 'system',
          addedAt: new Date(),
          lastVerified: new Date(),
          verificationHistory: [{
            date: new Date(),
            action: 'Airdrop created from external source',
            by: 'system',
            details: `Source: ${airdropData.source}`
          }]
        },
        analytics: {
          views: 0,
          claims: 0,
          successfulClaims: 0,
          totalValueClaimed: '0',
          averageClaimValue: '0',
          topClaimers: []
        }
      });

      const saved = await newAirdrop.save();
      
      // También crear en el modelo Airdrop original para compatibilidad
      await this.createLegacyAirdrop(airdropData);
      
      return saved;
    } catch (error: any) {
      console.error(`Error creando airdrop verificado:`, error);
      return null;
    }
  }

  /**
   * Actualiza un airdrop existente
   */
  private async updateExistingAirdrop(existingAirdrop: IVerifiedAirdrop, newData: any): Promise<void> {
    try {
      // Actualizar campos que pueden cambiar
      if (newData.description && newData.description !== existingAirdrop.description) {
        existingAirdrop.description = newData.description;
      }

      if (newData.website && newData.website !== existingAirdrop.website) {
        existingAirdrop.website = newData.website;
      }

      if (newData.endDate) {
        const newEndDate = new Date(newData.endDate);
        if (!existingAirdrop.endDate || newEndDate.getTime() !== existingAirdrop.endDate.getTime()) {
          existingAirdrop.endDate = newEndDate;
        }
      }

      if (newData.totalValue && newData.totalValue !== existingAirdrop.totalValue) {
        existingAirdrop.totalValue = newData.totalValue;
      }

      // Añadir nueva fuente si no existe
      const sourceExists = existingAirdrop.sources.some(source => 
        source.url === (newData.website || 'https://unknown.com')
      );

      if (!sourceExists) {
        existingAirdrop.sources.push({
          type: this.mapSourceType(newData.source),
          url: newData.website || 'https://unknown.com',
          lastUpdated: new Date(),
          confidence: this.calculateSourceConfidence(newData.source)
        });
      }

      // Actualizar timestamp de verificación
      existingAirdrop.metadata.lastVerified = new Date();

      await existingAirdrop.save();
    } catch (error: any) {
      console.error(`Error actualizando airdrop existente:`, error);
      throw error;
    }
  }

  /**
   * Verifica y actualiza información del contrato
   */
  private async verifyAndUpdateContract(contractAddress: string, blockchain: string): Promise<void> {
    try {
      const contractInfo = await contractVerificationService.verifyContract(contractAddress, blockchain);
      
      // Actualizar información del contrato en la base de datos
      await VerifiedAirdrop.updateOne(
        { contractAddress: contractAddress.toLowerCase() },
        {
          $set: {
            'contractInfo.verified': contractInfo.verified,
            'contractInfo.hasClaimFunction': contractInfo.hasClaimFunction || false,
            'contractInfo.owner': contractInfo.owner,
            'contractInfo.lastActivity': contractInfo.lastActivity,
            'metadata.lastVerified': new Date()
          }
        }
      );

      // Si el contrato es válido y verificado, mejorar nivel de verificación
      if (contractInfo.verified && contractInfo.isValid) {
        await VerifiedAirdrop.updateOne(
          { 
            contractAddress: contractAddress.toLowerCase(),
            verificationLevel: 'unverified' 
          },
          {
            $set: {
              verificationLevel: 'community',
              'risks.level': 'low'
            }
          }
        );
      }

    } catch (error: any) {
      console.error(`Error verificando contrato ${contractAddress}:`, error);
    }
  }

  /**
   * Actualiza airdrops existentes
   */
  private async updateExistingAirdrops(result: SyncResult): Promise<void> {
    try {
      // Marcar como acabados los airdrops cuya fecha de fin ha pasado
      const now = new Date();
      const expiredUpdate = await VerifiedAirdrop.updateMany(
        {
          status: { $in: ['active', 'upcoming'] },
          $or: [
            { endDate: { $lt: now } },
            { claimDeadline: { $lt: now } }
          ]
        },
        {
          $set: { status: 'ended' }
        }
      );

      console.log(`🔄 ${expiredUpdate.modifiedCount} airdrops marcados como expirados`);

      // Actualizar actividad de contratos
      const activeAirdrops = await VerifiedAirdrop.find({
        status: { $in: ['active', 'upcoming'] },
        contractAddress: { $ne: '' }
      });

      for (const airdrop of activeAirdrops) {
        try {
          const isActive = await contractVerificationService.isAirdropActive(
            airdrop.contractAddress, 
            airdrop.blockchain
          );

          if (!isActive && airdrop.status === 'active') {
            airdrop.status = 'ended';
            await airdrop.save();
            console.log(`⏰ Airdrop ${airdrop.name} marcado como inactivo`);
          }
        } catch (error) {
          // Continuar con el siguiente
        }
      }

    } catch (error: any) {
      console.error('Error actualizando airdrops existentes:', error);
      result.errors.push(`Error en actualización: ${error.message}`);
    }
  }

  /**
   * Limpia datos obsoletos
   */
  private async cleanupObsoleteData(): Promise<void> {
    try {
      // Eliminar airdrops muy antiguos sin actividad
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const deletedCount = await VerifiedAirdrop.deleteMany({
        status: 'ended',
        'metadata.lastVerified': { $lt: threeMonthsAgo },
        'analytics.views': { $lt: 10 },
        verificationLevel: 'unverified'
      });

      console.log(`🗑️ ${deletedCount.deletedCount} airdrops obsoletos eliminados`);

    } catch (error: any) {
      console.error('Error limpiando datos obsoletos:', error);
    }
  }

  /**
   * Actualiza estadísticas generales
   */
  private async updateStatistics(): Promise<void> {
    try {
      const stats = await VerifiedAirdrop.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalValue: { $sum: { $toDouble: '$totalValue' } }
          }
        }
      ]);

      console.log('📊 Estadísticas actualizadas:', stats);
    } catch (error: any) {
      console.error('Error actualizando estadísticas:', error);
    }
  }

  /**
   * Crea airdrop en modelo legacy para compatibilidad
   */
  private async createLegacyAirdrop(airdropData: any): Promise<void> {
    try {
      const { default: AirdropModel } = await import('../models/Airdrop');
      
      const existingLegacy = await AirdropModel.findOne({
        $or: [
          { contractAddress: airdropData.contractAddress },
          { name: airdropData.name }
        ]
      });

      if (!existingLegacy) {
        const legacyAirdrop = new AirdropModel({
          name: airdropData.name,
          symbol: airdropData.symbol,
          contractAddress: airdropData.contractAddress || '',
          tokenAddress: airdropData.tokenAddress || airdropData.contractAddress || '',
          blockchain: airdropData.blockchain || 'ethereum',
          description: airdropData.description || `${airdropData.name} token airdrop`,
          website: airdropData.website,
          twitter: airdropData.twitter,
          endDate: airdropData.endDate ? new Date(airdropData.endDate) : undefined,
          totalValue: airdropData.totalValue,
          requirements: airdropData.requirements || [],
          isActive: airdropData.status === 'active',
          eligibilityRules: {
            minBalance: '0',
            requiredTransactions: 0,
            snapshotDate: new Date()
          }
        });

        await legacyAirdrop.save();
      }
    } catch (error: any) {
      console.error('Error creando airdrop legacy:', error);
    }
  }

  /**
   * Mapea tipo de fuente
   */
  private mapSourceType(source: string): 'api' | 'scraping' | 'monitoring' | 'manual' {
    if (['coingecko', 'github'].includes(source)) return 'api';
    if (['airdrop-alert'].includes(source)) return 'scraping';
    if (['known-defi'].includes(source)) return 'manual';
    return 'api';
  }

  /**
   * Calcula confianza de la fuente
   */
  private calculateSourceConfidence(source: string): number {
    const confidenceMap: { [key: string]: number } = {
      'coingecko': 90,
      'known-defi': 95,
      'airdrop-alert': 70,
      'github': 60
    };

    return confidenceMap[source] || 50;
  }

  /**
   * Configura listeners para eventos de monitoreo
   */
  private setupEventListeners(): void {
    // Escuchar eventos del servicio de monitoreo
    blockchainMonitoringService.on('newAirdrop', async (event) => {
      console.log('🆕 Nuevo airdrop detectado por monitoreo:', event);
      await this.processDetectedAirdrop(event);
    });

    blockchainMonitoringService.on('airdropDetected', async (event) => {
      console.log('🎁 Posible airdrop detectado:', event);
      await this.processDetectedAirdrop(event);
    });

    blockchainMonitoringService.on('claimOpened', async (event) => {
      console.log('🔓 Claim abierto detectado:', event);
      await this.updateAirdropStatus(event.contractAddress, 'active');
    });
  }

  /**
   * Procesa airdrop detectado por monitoreo
   */
  private async processDetectedAirdrop(event: any): Promise<void> {
    try {
      // Verificar si ya existe
      const existing = await VerifiedAirdrop.findOne({
        contractAddress: event.contractAddress.toLowerCase()
      });

      if (existing) {
        // Actualizar actividad
        existing.contractInfo.lastActivity = event.timestamp;
        existing.metadata.lastVerified = new Date();
        await existing.save();
        return;
      }

      // Verificar contrato antes de crear
      const contractInfo = await contractVerificationService.verifyContract(
        event.contractAddress, 
        event.blockchain
      );

      if (!contractInfo.isValid) return;

      // Crear nuevo airdrop detectado
      const airdropData = {
        name: contractInfo.name || `Token ${event.contractAddress.slice(0, 8)}`,
        symbol: contractInfo.symbol || 'UNKNOWN',
        contractAddress: event.contractAddress,
        tokenAddress: event.tokenAddress || event.contractAddress,
        blockchain: event.blockchain,
        description: `Airdrop detectado automáticamente en blockchain ${event.blockchain}`,
        status: 'active',
        source: 'monitoring'
      };

      await this.createNewVerifiedAirdrop(airdropData);
      console.log(`✅ Airdrop automático creado: ${airdropData.name}`);

    } catch (error: any) {
      console.error('Error procesando airdrop detectado:', error);
    }
  }

  /**
   * Actualiza estado de airdrop
   */
  private async updateAirdropStatus(contractAddress: string, status: string): Promise<void> {
    try {
      await VerifiedAirdrop.updateOne(
        { contractAddress: contractAddress.toLowerCase() },
        {
          $set: {
            status,
            'metadata.lastVerified': new Date()
          }
        }
      );
    } catch (error: any) {
      console.error('Error actualizando estado de airdrop:', error);
    }
  }

  /**
   * Inicia monitoreo automático
   */
  async startAutomaticMonitoring(): Promise<void> {
    try {
      console.log('🔄 Iniciando monitoreo automático...');
      
      // Iniciar monitoreo de blockchain
      await blockchainMonitoringService.startMonitoring();
      
      // Programar sincronización cada 6 horas
      setInterval(async () => {
        try {
          console.log('⏰ Ejecutando sincronización programada...');
          await this.syncRealAirdrops();
        } catch (error) {
          console.error('Error en sincronización programada:', error);
        }
      }, 6 * 60 * 60 * 1000); // 6 horas

      console.log('✅ Monitoreo automático iniciado');
    } catch (error: any) {
      console.error('Error iniciando monitoreo automático:', error);
      throw error;
    }
  }

  /**
   * Obtiene resultado de la última sincronización
   */
  getLastSyncResult(): SyncResult | null {
    return this.lastSyncResult;
  }

  /**
   * Verifica si está sincronizando
   */
  isSyncInProgress(): boolean {
    return this.isSyncing;
  }
}

export default new AirdropSyncService();