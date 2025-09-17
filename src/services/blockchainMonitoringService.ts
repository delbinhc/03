import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

interface AirdropEvent {
  type: 'new_airdrop' | 'claim_opened' | 'token_transfer' | 'contract_deployed';
  contractAddress: string;
  tokenAddress?: string;
  blockchain: string;
  transactionHash: string;
  blockNumber: number;
  timestamp: Date;
  data: any;
}

interface MonitoringConfig {
  blockchain: string;
  wsUrl: string;
  httpUrl: string;
  events: string[];
  contracts?: string[];
}

export class BlockchainMonitoringService extends EventEmitter {
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();
  private wsConnections: Map<string, WebSocket> = new Map();
  private monitoringConfigs: Map<string, MonitoringConfig> = new Map();
  private isMonitoring: boolean = false;
  private reconnectAttempts: Map<string, number> = new Map();
  private maxReconnectAttempts: number = parseInt(process.env.WEBSOCKET_MAX_RETRIES || '3');
  private reconnectInterval: number = parseInt(process.env.WEBSOCKET_RECONNECT_INTERVAL || '300000'); // 5 minutos
  private isProduction: boolean = process.env.NODE_ENV === 'production';

  constructor() {
    super();
    this.setupMonitoringConfigs();
  }

  private setupMonitoringConfigs(): void {
    // Configuraciones para diferentes blockchains usando URLs gratuitas
    this.monitoringConfigs.set('ethereum', {
      blockchain: 'ethereum',
      wsUrl: `wss://ethereum-rpc.publicnode.com`,
      httpUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
      events: [
        'Transfer', // Transferencias de tokens
        'Approval', // Aprobaciones
        'NewAirdrop', // Eventos personalizados de airdrop
        'ClaimOpened', // Apertura de claims
      ]
    });

    this.monitoringConfigs.set('polygon', {
      blockchain: 'polygon',
      wsUrl: `wss://polygon-bor-rpc.publicnode.com`,
      httpUrl: process.env.POLYGON_RPC_URL || 'https://polygon.llamarpc.com',
      events: ['Transfer', 'Approval', 'NewAirdrop', 'ClaimOpened']
    });

    this.monitoringConfigs.set('bsc', {
      blockchain: 'bsc',
      wsUrl: 'wss://bsc-rpc.publicnode.com',
      httpUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/',
      events: ['Transfer', 'Approval', 'NewAirdrop', 'ClaimOpened']
    });
  }

  /**
   * Inicia el monitoreo de eventos en todas las blockchains configuradas
   */
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      console.log('⚠️ El monitoreo ya está activo');
      return;
    }

    console.log('🚀 Iniciando monitoreo de eventos blockchain...');
    this.isMonitoring = true;

    for (const [blockchain, config] of this.monitoringConfigs) {
      try {
        await this.startBlockchainMonitoring(blockchain, config);
        console.log(`✅ Monitoreo iniciado para ${blockchain}`);
      } catch (error) {
        console.error(`❌ Error iniciando monitoreo para ${blockchain}:`, error);
      }
    }

    // Monitoreo de nuevos contratos desplegados
    this.startNewContractMonitoring();
    
    // Monitoreo de airdrops conocidos
    this.startKnownAirdropMonitoring();

    console.log('🔄 Sistema de monitoreo blockchain completamente activo');
  }

  /**
   * Inicia monitoreo para una blockchain específica
   */
  private async startBlockchainMonitoring(blockchain: string, config: MonitoringConfig): Promise<void> {
    // Configurar provider HTTP
    const provider = new ethers.JsonRpcProvider(config.httpUrl);
    this.providers.set(blockchain, provider);

    // Configurar conexión WebSocket para eventos en tiempo real
    await this.setupWebSocketConnection(blockchain, config);

    // Monitorear eventos específicos
    this.setupEventListeners(blockchain, provider);
  }

  /**
   * Configura conexión WebSocket para eventos en tiempo real
   */
  private async setupWebSocketConnection(blockchain: string, config: MonitoringConfig): Promise<void> {
    try {
      const ws = new WebSocket(config.wsUrl);
      this.wsConnections.set(blockchain, ws);

      ws.on('open', () => {
        console.log(`🔗 WebSocket conectado para ${blockchain}`);
        
        // Suscribirse a nuevos bloques
        ws.send(JSON.stringify({
          id: 1,
          method: 'eth_subscribe',
          params: ['newHeads']
        }));

        // Suscribirse a logs de contratos
        ws.send(JSON.stringify({
          id: 2,
          method: 'eth_subscribe',
          params: ['logs', {
            topics: [
              [
                ethers.id('Transfer(address,address,uint256)'),
                ethers.id('NewAirdrop(address,uint256,uint256)'),
                ethers.id('ClaimOpened(address,uint256)')
              ]
            ]
          }]
        }));
      });

      ws.on('message', (data: any) => {
        this.handleWebSocketMessage(blockchain, Buffer.from(data));
      });

      ws.on('error', (error) => {
        if (!this.isProduction) {
          console.error(`❌ Error WebSocket ${blockchain}:`, error);
        }
        this.reconnectWebSocket(blockchain, config);
      });

      ws.on('close', () => {
        if (!this.isProduction) {
          console.log(`🔌 WebSocket cerrado para ${blockchain}`);
        }
        this.reconnectWebSocket(blockchain, config);
      });

    } catch (error) {
      console.error(`Error configurando WebSocket para ${blockchain}:`, error);
    }
  }

  /**
   * Maneja mensajes del WebSocket
   */
  private handleWebSocketMessage(blockchain: string, data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.method === 'eth_subscription') {
        const result = message.params.result;
        
        if (result.transactionHash) {
          // Es un log de evento
          this.processEventLog(blockchain, result);
        } else if (result.number) {
          // Es un nuevo bloque
          this.processNewBlock(blockchain, result);
        }
      }
    } catch (error) {
      console.error(`Error procesando mensaje WebSocket:`, error);
    }
  }

  /**
   * Procesa logs de eventos
   */
  private async processEventLog(blockchain: string, log: any): Promise<void> {
    try {
      const provider = this.providers.get(blockchain);
      if (!provider) return;

      // Obtener detalles de la transacción
      const tx = await provider.getTransaction(log.transactionHash);
      if (!tx) return;

      // Decodificar el evento
      const eventSignature = log.topics[0];
      let eventType: AirdropEvent['type'] = 'token_transfer';

      // Identificar tipo de evento
      if (eventSignature === ethers.id('Transfer(address,address,uint256)')) {
        await this.handleTransferEvent(blockchain, log, tx);
      } else if (eventSignature === ethers.id('NewAirdrop(address,uint256,uint256)')) {
        eventType = 'new_airdrop';
        await this.handleNewAirdropEvent(blockchain, log, tx);
      } else if (eventSignature === ethers.id('ClaimOpened(address,uint256)')) {
        eventType = 'claim_opened';
        await this.handleClaimOpenedEvent(blockchain, log, tx);
      }

      console.log(`📡 Evento detectado: ${eventType} en ${blockchain}`);
    } catch (error) {
      console.error(`Error procesando event log:`, error);
    }
  }

  /**
   * Maneja eventos Transfer para detectar posibles airdrops
   */
  private async handleTransferEvent(blockchain: string, log: any, tx: any): Promise<void> {
    try {
      // Decodificar el evento Transfer
      const transferInterface = new ethers.Interface([
        'event Transfer(address indexed from, address indexed to, uint256 value)'
      ]);

      const decoded = transferInterface.parseLog({
        topics: log.topics,
        data: log.data
      });

      if (!decoded) return;

      const { from, to, value } = decoded.args;

      // Detectar posibles airdrops (transferencias desde 0x0 o desde contratos a múltiples direcciones)
      if (from === ethers.ZeroAddress || await this.isLikelyAirdropPattern(log.address, blockchain)) {
        const airdropEvent: AirdropEvent = {
          type: 'token_transfer',
          contractAddress: log.address,
          tokenAddress: log.address,
          blockchain,
          transactionHash: log.transactionHash,
          blockNumber: parseInt(log.blockNumber, 16),
          timestamp: new Date(),
          data: {
            from,
            to,
            value: value.toString(),
            possibleAirdrop: true
          }
        };

        this.emit('airdropDetected', airdropEvent);
        console.log(`🎁 Posible airdrop detectado: ${log.address} en ${blockchain}`);
      }
    } catch (error) {
      console.error(`Error manejando evento Transfer:`, error);
    }
  }

  /**
   * Maneja eventos de nuevo airdrop
   */
  private async handleNewAirdropEvent(blockchain: string, log: any, tx: any): Promise<void> {
    try {
      const airdropEvent: AirdropEvent = {
        type: 'new_airdrop',
        contractAddress: tx.to || log.address,
        tokenAddress: log.address,
        blockchain,
        transactionHash: log.transactionHash,
        blockNumber: parseInt(log.blockNumber, 16),
        timestamp: new Date(),
        data: {
          rawLog: log,
          transaction: tx
        }
      };

      this.emit('newAirdrop', airdropEvent);
      console.log(`🆕 Nuevo airdrop oficial detectado: ${log.address} en ${blockchain}`);
    } catch (error) {
      console.error(`Error manejando evento NewAirdrop:`, error);
    }
  }

  /**
   * Maneja eventos de apertura de claim
   */
  private async handleClaimOpenedEvent(blockchain: string, log: any, tx: any): Promise<void> {
    try {
      const airdropEvent: AirdropEvent = {
        type: 'claim_opened',
        contractAddress: log.address,
        blockchain,
        transactionHash: log.transactionHash,
        blockNumber: parseInt(log.blockNumber, 16),
        timestamp: new Date(),
        data: {
          rawLog: log,
          transaction: tx
        }
      };

      this.emit('claimOpened', airdropEvent);
      console.log(`🔓 Claim abierto detectado: ${log.address} en ${blockchain}`);
    } catch (error) {
      console.error(`Error manejando evento ClaimOpened:`, error);
    }
  }

  /**
   * Procesa nuevos bloques
   */
  private async processNewBlock(blockchain: string, blockData: any): Promise<void> {
    try {
      const blockNumber = parseInt(blockData.number, 16);
      console.log(`🆕 Nuevo bloque ${blockNumber} en ${blockchain}`);

      // Analizar transacciones del bloque en busca de deployments de contratos
      const provider = this.providers.get(blockchain);
      if (!provider) return;

      const block = await provider.getBlock(blockNumber, true);
      if (!block || !block.transactions) return;

      for (const txHash of block.transactions.slice(0, 10)) { // Limitar a 10 transacciones por bloque
        try {
          const tx = await provider.getTransaction(txHash as string);
          if (tx && !tx.to && tx.data && tx.data !== '0x') {
            // Es un deployment de contrato
            await this.analyzeNewContract(blockchain, tx);
          }
        } catch (error) {
          // Continuar con la siguiente transacción
        }
      }
    } catch (error) {
      console.error(`Error procesando nuevo bloque:`, error);
    }
  }

  /**
   * Analiza nuevos contratos deployados
   */
  private async analyzeNewContract(blockchain: string, tx: any): Promise<void> {
    try {
      const provider = this.providers.get(blockchain);
      if (!provider) return;

      const receipt = await provider.getTransactionReceipt(tx.hash);
      if (!receipt || !receipt.contractAddress) return;

      const contractAddress = receipt.contractAddress;
      
      // Heurística simple: verificar si el bytecode contiene strings relacionados con airdrops
      const bytecode = tx.data.toLowerCase();
      const airdropKeywords = [
        'airdrop', 'claim', 'distribute', 'reward', 'bonus'
      ];

      const hasAirdropKeywords = airdropKeywords.some(keyword => 
        bytecode.includes(ethers.keccak256(ethers.toUtf8Bytes(keyword)).slice(0, 10))
      );

      if (hasAirdropKeywords) {
        const airdropEvent: AirdropEvent = {
          type: 'contract_deployed',
          contractAddress,
          blockchain,
          transactionHash: tx.hash,
          blockNumber: receipt.blockNumber,
          timestamp: new Date(),
          data: {
            deployer: tx.from,
            bytecodeSize: tx.data.length,
            possibleAirdrop: true
          }
        };

        this.emit('contractDeployed', airdropEvent);
        console.log(`📝 Posible contrato de airdrop deployado: ${contractAddress} en ${blockchain}`);
      }
    } catch (error) {
      console.error(`Error analizando nuevo contrato:`, error);
    }
  }

  /**
   * Verifica si un patrón parece ser un airdrop
   */
  private async isLikelyAirdropPattern(tokenAddress: string, blockchain: string): Promise<boolean> {
    try {
      const provider = this.providers.get(blockchain);
      if (!provider) return false;

      // Obtener logs de Transfer recientes para este token
      const currentBlock = await provider.getBlockNumber();
      const fromBlock = currentBlock - 100; // Últimos 100 bloques

      const logs = await provider.getLogs({
        address: tokenAddress,
        topics: [ethers.id('Transfer(address,address,uint256)')],
        fromBlock,
        toBlock: currentBlock
      });

      // Si hay muchas transferencias en poco tiempo, podría ser un airdrop
      if (logs.length > 50) {
        // Verificar si las transferencias son desde una dirección común (distribuidor)
        const fromAddresses = new Set();
        logs.forEach(log => {
          if (log.topics[1]) {
            fromAddresses.add(log.topics[1]);
          }
        });

        // Si la mayoría viene de una sola dirección, es probable que sea un airdrop
        return fromAddresses.size <= 3;
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Monitorea airdrops conocidos
   */
  private startKnownAirdropMonitoring(): void {
    const knownAirdropContracts = [
      // Agregar direcciones de contratos de airdrop conocidos
      '0x912CE59144191C1204E64559FE8253a0e49E6548', // Arbitrum
      '0x4200000000000000000000000000000000000042', // Optimism
    ];

    for (const contractAddress of knownAirdropContracts) {
      this.monitorSpecificContract(contractAddress, 'ethereum');
    }
  }

  /**
   * Monitorea un contrato específico
   */
  private async monitorSpecificContract(contractAddress: string, blockchain: string): Promise<void> {
    try {
      const provider = this.providers.get(blockchain);
      if (!provider) return;

      // Configurar filtros para eventos del contrato
      const filter = {
        address: contractAddress,
        topics: [
          [
            ethers.id('Transfer(address,address,uint256)'),
            ethers.id('Claim(address,uint256)'),
            ethers.id('NewAirdrop(address,uint256,uint256)')
          ]
        ]
      };

      provider.on(filter, (log) => {
        console.log(`📋 Evento en contrato monitoreado ${contractAddress}:`, log);
        this.emit('monitoredContractEvent', {
          contractAddress,
          blockchain,
          log
        });
      });

    } catch (error) {
      console.error(`Error monitoreando contrato específico ${contractAddress}:`, error);
    }
  }

  /**
   * Monitorea nuevos contratos desplegados
   */
  private startNewContractMonitoring(): void {
    console.log('🔍 Iniciando monitoreo de nuevos contratos...');
    
    // El monitoreo se hace a través del análisis de bloques en processNewBlock()
    // Aquí podríamos agregar lógica adicional específica para nuevos contratos
  }

  /**
   * Reconecta WebSocket con backoff exponencial y límite de reintentos
   */
  private async reconnectWebSocket(blockchain: string, config: MonitoringConfig): Promise<void> {
    const attempts = this.reconnectAttempts.get(blockchain) || 0;
    
    if (attempts >= this.maxReconnectAttempts) {
      if (!this.isProduction) {
        console.warn(`⚠️ Máximo de reintentos alcanzado para ${blockchain}. Deteniendo reconexión.`);
      }
      return;
    }

    const delay = Math.min(this.reconnectInterval * Math.pow(2, attempts), 600000); // Max 10 minutos
    
    if (!this.isProduction) {
      console.log(`🔄 Reconectando WebSocket para ${blockchain} en ${delay/1000}s (intento ${attempts + 1}/${this.maxReconnectAttempts})`);
    }
    
    setTimeout(async () => {
      try {
        this.reconnectAttempts.set(blockchain, attempts + 1);
        await this.setupWebSocketConnection(blockchain, config);
        // Reset contador si la conexión fue exitosa
        this.reconnectAttempts.set(blockchain, 0);
      } catch (error) {
        if (!this.isProduction) {
          console.error(`Error reconectando WebSocket para ${blockchain}:`, error);
        }
      }
    }, delay);
  }

  /**
   * Configura listeners de eventos del provider
   */
  private setupEventListeners(blockchain: string, provider: ethers.JsonRpcProvider): void {
    // Escuchar nuevos bloques
    provider.on('block', (blockNumber) => {
      console.log(`📦 Nuevo bloque ${blockNumber} en ${blockchain}`);
    });

    // Manejar errores del provider
    provider.on('error', (error) => {
      console.error(`❌ Error del provider ${blockchain}:`, error);
    });
  }

  /**
   * Detiene el monitoreo
   */
  async stopMonitoring(): Promise<void> {
    console.log('🛑 Deteniendo monitoreo de eventos...');
    this.isMonitoring = false;

    // Cerrar conexiones WebSocket
    for (const [blockchain, ws] of this.wsConnections) {
      try {
        ws.close();
        console.log(`🔌 WebSocket cerrado para ${blockchain}`);
      } catch (error) {
        console.error(`Error cerrando WebSocket ${blockchain}:`, error);
      }
    }

    // Remover listeners de providers
    for (const [blockchain, provider] of this.providers) {
      try {
        provider.removeAllListeners();
        console.log(`👂 Listeners removidos para ${blockchain}`);
      } catch (error) {
        console.error(`Error removiendo listeners ${blockchain}:`, error);
      }
    }

    this.wsConnections.clear();
    this.providers.clear();
    console.log('✅ Monitoreo completamente detenido');
  }

  /**
   * Obtiene estadísticas del monitoreo
   */
  getMonitoringStats(): any {
    return {
      isMonitoring: this.isMonitoring,
      activeBlockchains: Array.from(this.providers.keys()),
      activeWebSockets: Array.from(this.wsConnections.keys()),
      eventsEmitted: this.listenerCount('airdropDetected') + 
                    this.listenerCount('newAirdrop') + 
                    this.listenerCount('claimOpened') + 
                    this.listenerCount('contractDeployed')
    };
  }
}

export default new BlockchainMonitoringService();