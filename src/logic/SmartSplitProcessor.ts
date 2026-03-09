import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

export interface SmartSplitConfig {
    empresa: string;
    projeto: string;
    equipe: string;
    tipoDoc: string;
    rotuloNome: string;
    rotuloPeriodo: string;
    rotuloDepto: string;
}

export interface SmartSplitResult {
    nomeArquivo: string;
    pagina: number;
    nomeColaborador: string;
    periodo: string;
    depto: string;
    encontrado: boolean;
}

export const CONFIG_KEY = 'smartSplitConfig';

export const defaultConfig: SmartSplitConfig = {
    empresa: 'AEDAS',
    projeto: 'MRD',
    equipe: 'ADM',
    tipoDoc: 'DEMONSTRATIVOS',
    rotuloNome: 'Func.:',
    rotuloPeriodo: 'Período:',
    rotuloDepto: 'Depto.:',
};

export function loadConfig(): SmartSplitConfig {
    try {
        const saved = localStorage.getItem(CONFIG_KEY);
        if (saved) return { ...defaultConfig, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return { ...defaultConfig };
}

export function saveConfig(config: SmartSplitConfig) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

async function extractPagesText(pdfBytes: Uint8Array): Promise<string[]> {
    const doc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items.map((item: any) => item.str).join(' ');
        pages.push(text);
    }
    return pages;
}

/**
 * Escapa o rótulo para uso em regex e permite variação de acentos.
 * Ex: "Período:" → "Per[ií]odo[:]?" case-insensitive
 */
function escaparRotulo(rotulo: string): string {
    return rotulo
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        // Flexibiliza caracteres acentuados comuns
        .replace('í', '[íi]')
        .replace('ê', '[êe]')
        .replace('ã', '[ãa]')
        .replace('é', '[ée]');
}

/**
 * Extrai campo que usa CÓDIGO NUMÉRICO antes do valor:
 * Ex: "Func.: 052191 - FULANO DOS SANTOS"  →  "FULANO DOS SANTOS"
 * Ex: "Depto.: 000025 - PROJETO ITUETA"   →  "PROJETO ITUETA E RESPLENDOR"
 *
 * Exigir o código numérico evita casamento errado quando os labels aparecem
 * em ordem inesperada no texto extraído pelo PDF.js.
 */
function extrairCampoComCodigo(texto: string, rotulo: string): string {
    const rotuloEsc = escaparRotulo(rotulo);
    // CÓDIGO (4-6 dígitos) + DASH + VALOR (para antes do próximo label "PALAVRA:" ou data)
    const regex = new RegExp(
        rotuloEsc + '\\s*\\d{4,6}\\s*-\\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][^\\d:]{2,60}?)(?=\\s*\\S+\\s*[.:,]|\\d{2}\\s*[/\\-]|$)',
        'i'
    );
    const match = texto.match(regex);
    return match ? match[1].trim() : '';
}

/**
 * Extrai período no formato MM/AAAA e converte para AAAAMM.
 * Aceita variações de espaço e acentuação no rótulo.
 * Ex: "Período: 02/2026" → "202602"
 */
function extrairPeriodo(texto: string, rotulo: string): string {
    const rotuloEsc = escaparRotulo(rotulo);
    // Permite espaço ao redor da barra e barras de diferentes tipos
    const regex = new RegExp(rotuloEsc + '\\s*(\\d{2})\\s*[/\\-]\\s*(\\d{4})', 'i');
    const match = texto.match(regex);
    if (match) return `${match[1]}${match[2]}`; // MM + AAAA = MMAAAA

    return '';
}

/**
 * Abrevia o nome para PRIMEIRO + ÚLTIMO nome, filtrando preposições.
 * Ex: "FERNANDA ALVES DE OLIVEIRA" → "FERNANDA OLIVEIRA"
 * Ex: "JOSE CARLOS" → "JOSE CARLOS" (mantém, já é curto)
 */
function abreviarNome(nome: string): string {
    const preposicoes = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'EM', 'DI']);
    const partes = nome.trim().split(/\s+/).filter(p => !preposicoes.has(p.toUpperCase()));
    if (partes.length <= 2) return partes.join(' ');
    return `${partes[0]} ${partes[partes.length - 1]}`;
}

/**
 * Normaliza string para nome de arquivo: remove acentos, espaços → _
 */
function normalizar(texto: string): string {
    return texto
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '_')
        .replace(/[^A-Za-z0-9_]/g, '')
        .toUpperCase();
}

export async function previewSmartSplit(
    pdfBytes: Uint8Array,
    config: SmartSplitConfig
): Promise<SmartSplitResult[]> {
    const pagesText = await extractPagesText(pdfBytes);
    return pagesText.map((texto, idx) => {
        const nomeRaw = extrairCampoComCodigo(texto, config.rotuloNome);
        const deptoRaw = extrairCampoComCodigo(texto, config.rotuloDepto);
        const periodoRaw = extrairPeriodo(texto, config.rotuloPeriodo);

        const nomeAbrev = nomeRaw ? abreviarNome(nomeRaw) : '';
        const nome = nomeAbrev ? normalizar(nomeAbrev) : '';
        const depto = deptoRaw ? normalizar(deptoRaw) : '';
        const periodo = periodoRaw || '';
        const encontrado = !!(nome && periodo);

        const prefixos = [
            periodo || 'SEM_PERIODO',
            config.empresa,
            config.projeto,
            depto || 'SEM_DEPTO',
            config.equipe,
            config.tipoDoc,
            nome || `PAGINA_${idx + 1}`,
        ].join('_');

        return {
            nomeArquivo: `${prefixos}.pdf`,
            pagina: idx + 1,
            nomeColaborador: nomeAbrev || nomeRaw || '',
            periodo: periodoRaw || '',
            depto: deptoRaw || '',
            encontrado,
        };
    });
}
