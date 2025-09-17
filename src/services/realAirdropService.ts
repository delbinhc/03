import axios from 'axios';
import * as cheerio from 'cheerio';
import { IAirdrop } from '../models/Airdrop';

interface RealAirdropData {
  name: string;
  symbol: string;
  contractAddress: string;
  tokenAddress: string;
  blockchain: string;
  description: string;
  website?: string;
  twitter?: string;
  endDate?: string;
  totalValue?: string;
  requirements?: string[];
  status: 'active' | 'ended' | 'upcoming';
  source: string;
}

export class RealAirdropService {
  private readonly COINGECKO_API = 'https://api.coingecko.com/api/v3';
  private readonly DEBANK_API = 'https://openapi.debank.com/v1';
  private readonly ETHERSCAN_API = 'https://api.etherscan.io/api';
  
  constructor() {
    this.setupAxiosDefaults();
  }

  private setupAxiosDefaults() {
    // Configurar headers para evitar blocking
    axios.defaults.headers.common['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    axios.defaults.timeout = 15000;
  }

  /**
   * Obtiene airdrops desde múltiples fuentes
   */
  async fetchRealAirdrops(): Promise<RealAirdropData[]> {
    const airdrops: RealAirdropData[] = [];

    try {
      // Fuente 1: Airdrop Alert (web scraping)
      const airdropAlertData = await this.scrapeAirdropAlert();
      airdrops.push(...airdropAlertData);

      // Fuente 2: CoinMarketCap Airdrops
      const cmcData = await this.fetchCoinMarketCapAirdrops();
      airdrops.push(...cmcData);

      // Fuente 3: DeFi proyectos conocidos
      const defiData = await this.fetchKnownDeFiAirdrops();
      airdrops.push(...defiData);

      // Fuente 4: GitHub trending repos con tokens
      const githubData = await this.fetchGitHubTrendingTokens();
      airdrops.push(...githubData);

      console.log(`📊 Total airdrops encontrados: ${airdrops.length}`);
      return this.deduplicateAirdrops(airdrops);
    } catch (error) {
      console.error('❌ Error fetching real airdrops:', error);
      return [];
    }
  }

  /**
   * Scrape Airdrop Alert para airdrops activos
   */
  private async scrapeAirdropAlert(): Promise<RealAirdropData[]> {
    try {
      const response = await axios.get('https://airdropalert.com/');
      const $ = cheerio.load(response.data);
      const airdrops: RealAirdropData[] = [];

      $('.airdrop-item').each((_: number, element: any) => {
        const $item = $(element);
        const name = $item.find('.airdrop-title').text().trim();
        const description = $item.find('.airdrop-description').text().trim();
        const endDate = $item.find('.airdrop-end-date').text().trim();
        const value = $item.find('.airdrop-value').text().trim();

        if (name && description) {
          airdrops.push({
            name,
            symbol: this.extractSymbolFromName(name),
            contractAddress: '', // Se completará después con verificación
            tokenAddress: '',
            blockchain: 'ethereum', // Default, se detectará después
            description,
            endDate: endDate || undefined,
            totalValue: value || undefined,
            status: 'active',
            source: 'airdrop-alert'
          });
        }
      });

      console.log(`🔍 Airdrop Alert: ${airdrops.length} airdrops encontrados`);
      return airdrops;
    } catch (error) {
      console.error('Error scraping Airdrop Alert:', error);
      return [];
    }
  }

  /**
   * Obtiene airdrops desde CoinMarketCap
   */
  private async fetchCoinMarketCapAirdrops(): Promise<RealAirdropData[]> {
    try {
      // Usar API de CoinMarketCap para airdrops
      const response = await axios.get(`${this.COINGECKO_API}/coins/markets`, {
        params: {
          vs_currency: 'usd',
          category: 'airdrop',
          order: 'market_cap_desc',
          per_page: 50,
          page: 1,
          sparkline: false
        }
      });

      const airdrops: RealAirdropData[] = response.data.map((coin: any) => ({
        name: coin.name,
        symbol: coin.symbol.toUpperCase(),
        contractAddress: coin.contract_address || '',
        tokenAddress: coin.contract_address || '',
        blockchain: this.detectBlockchainFromContract(coin.contract_address),
        description: `${coin.name} token - Market Cap: $${coin.market_cap?.toLocaleString()}`,
        website: coin.homepage?.[0],
        status: 'active' as const,
        source: 'coingecko'
      }));

      console.log(`💰 CoinGecko: ${airdrops.length} tokens encontrados`);
      return airdrops;
    } catch (error) {
      console.error('Error fetching CoinMarketCap airdrops:', error);
      return [];
    }
  }

  /**
   * Obtiene airdrops de proyectos DeFi conocidos
   */
  private async fetchKnownDeFiAirdrops(): Promise<RealAirdropData[]> {
    const knownAirdrops: RealAirdropData[] = [
      // Airdrops reales conocidos que podrían estar activos
      {
        name: 'Arbitrum',
        symbol: 'ARB',
        contractAddress: '0x912CE59144191C1204E64559FE8253a0e49E6548',
        tokenAddress: '0x912CE59144191C1204E64559FE8253a0e49E6548',
        blockchain: 'arbitrum',
        description: 'Arbitrum governance token airdrop for early users',
        website: 'https://arbitrum.io',
        status: 'ended',
        source: 'known-defi'
      },
      {
        name: 'Optimism',
        symbol: 'OP',
        contractAddress: '0x4200000000000000000000000000000000000042',
        tokenAddress: '0x4200000000000000000000000000000000000042',
        blockchain: 'optimism',
        description: 'Optimism governance token for Layer 2 users',
        website: 'https://optimism.io',
        status: 'ended',
        source: 'known-defi'
      },
      // Agregar más airdrops conocidos...
    ];

    // Verificar cuáles siguen activos
    const activeAirdrops = await this.verifyAirdropStatus(knownAirdrops);
    console.log(`🏛️ DeFi conocidos: ${activeAirdrops.length} airdrops verificados`);
    return activeAirdrops;
  }

  /**
   * Busca nuevos tokens en GitHub trending
   */
  private async fetchGitHubTrendingTokens(): Promise<RealAirdropData[]> {
    try {
      const response = await axios.get('https://api.github.com/search/repositories', {
        params: {
          q: 'airdrop token created:>2024-01-01',
          sort: 'stars',
          order: 'desc',
          per_page: 20
        }
      });

      const airdrops: RealAirdropData[] = response.data.items
        .filter((repo: any) => repo.description?.toLowerCase().includes('airdrop'))
        .map((repo: any) => ({
          name: repo.name,
          symbol: this.extractSymbolFromName(repo.name),
          contractAddress: '',
          tokenAddress: '',
          blockchain: 'ethereum',
          description: repo.description || 'GitHub trending airdrop project',
          website: repo.homepage || repo.html_url,
          status: 'upcoming' as const,
          source: 'github'
        }));

      console.log(`🐙 GitHub: ${airdrops.length} proyectos encontrados`);
      return airdrops;
    } catch (error) {
      console.error('Error fetching GitHub trending:', error);
      return [];
    }
  }

  /**
   * Verifica el estado actual de airdrops
   */
  private async verifyAirdropStatus(airdrops: RealAirdropData[]): Promise<RealAirdropData[]> {
    const verifiedAirdrops: RealAirdropData[] = [];

    for (const airdrop of airdrops) {
      if (airdrop.contractAddress) {
        try {
          const isActive = await this.checkContractActivity(airdrop.contractAddress, airdrop.blockchain);
          if (isActive) {
            verifiedAirdrops.push({ ...airdrop, status: 'active' });
          }
        } catch (error) {
          console.error(`Error verifying ${airdrop.name}:`, error);
        }
      }
    }

    return verifiedAirdrops;
  }

  /**
   * Verifica si un contrato está activo
   */
  private async checkContractActivity(contractAddress: string, blockchain: string): Promise<boolean> {
    try {
      const etherscanApiKey = process.env.ETHERSCAN_API_KEY;
      if (!etherscanApiKey) return false;

      const response = await axios.get(this.ETHERSCAN_API, {
        params: {
          module: 'contract',
          action: 'getabi',
          address: contractAddress,
          apikey: etherscanApiKey
        }
      });

      return response.data.status === '1';
    } catch (error) {
      return false;
    }
  }

  /**
   * Detecta blockchain desde dirección de contrato
   */
  private detectBlockchainFromContract(address: string): string {
    if (!address) return 'ethereum';
    
    // Heurísticas para detectar blockchain
    if (address.startsWith('0x') && address.length === 42) {
      return 'ethereum'; // Default para addresses válidas
    }
    return 'ethereum';
  }

  /**
   * Extrae símbolo del nombre del proyecto
   */
  private extractSymbolFromName(name: string): string {
    // Buscar patrón común: "ProjectName (SYMBOL)"
    const match = name.match(/\(([A-Z]{2,10})\)/);
    if (match) {
      return match[1];
    }
    
    // Usar primeras 3-4 letras del nombre
    return name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase();
  }

  /**
   * Elimina airdrops duplicados
   */
  private deduplicateAirdrops(airdrops: RealAirdropData[]): RealAirdropData[] {
    const seen = new Set<string>();
    return airdrops.filter(airdrop => {
      const key = `${airdrop.name.toLowerCase()}-${airdrop.symbol.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Obtiene información detallada de un token desde DeFiPulse
   */
  async getTokenDetails(contractAddress: string): Promise<any> {
    try {
      const response = await axios.get(`${this.COINGECKO_API}/coins/ethereum/contract/${contractAddress}`);
      return response.data;
    } catch (error) {
      console.error('Error getting token details:', error);
      return null;
    }
  }

  /**
   * Monitorea eventos de airdrops en tiempo real
   */
  async startRealTimeMonitoring(): Promise<void> {
    console.log('🔄 Iniciando monitoreo en tiempo real...');
    
    // Configurar cron job para verificar nuevos airdrops cada hora
    setInterval(async () => {
      try {
        const newAirdrops = await this.fetchRealAirdrops();
        if (newAirdrops.length > 0) {
          console.log(`🆕 ${newAirdrops.length} nuevos airdrops detectados`);
          // Aquí integrarías con tu base de datos
        }
      } catch (error) {
        console.error('Error en monitoreo en tiempo real:', error);
      }
    }, 60 * 60 * 1000); // Cada hora
  }
}

export default new RealAirdropService();