import * as pdfjsLib from 'pdfjs-dist';

// Use o worker do próprio pdfjs-dist para garantir compatibilidade
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

/**
 * Extrai texto de todas as páginas de forma bruta.
 */
async function extractRawPagesText(pdfBytes: Uint8Array): Promise<string[]> {
    const doc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items.map((item: any) => item.str || '').join(' ');
        pages.push(text);
    }
    return pages;
}

/**
 * Normaliza o texto para busca (remove acentos, espaços extras, caixa alta).
 */
function normalizarParaBusca(texto: string): string {
    return texto
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .toUpperCase()
        .trim();
}

/**
 * Escapa caracteres especiais para regex.
 */
function escaparParaRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extrai um campo baseado em um rótulo.
 */
function extrairComRotulo(texto: string, rotulo: string): string {
    const rotNorm = normalizarParaBusca(rotulo);
    const rotEsc = escaparParaRegex(rotNorm).replace(':', '[:]?');

    // Procura o rótulo e pega o que vem depois até o próximo rótulo provável ou fim de linha.
    // O próximo rótulo é identificado por uma palavra seguida de : ou uma data.
    const regex = new RegExp(rotEsc + '\\s*(?:\\d+\\s*-\\s*)?([^:]{2,100}?)(?=\\s+[A-Z]{2,15}\\s*[:]|\\d{2}[/.-]\\d{4}|\\s*$)', 'i');
    const match = texto.match(regex);

    if (match) {
        return match[1].trim();
    }
    return '';
}

/**
 * Extrai o período (MM/YYYY) e converte para YYYYMM.
 */
function extrairPeriodoRobusto(texto: string, rotulo: string): string {
    const rotNorm = normalizarParaBusca(rotulo);
    const rotEsc = escaparParaRegex(rotNorm).replace(':', '[:]?');

    // Tenta primeiro com o rótulo
    const regexComRotulo = new RegExp(rotEsc + '\\s*(\\d{2})\\s*[/.-]\\s*(\\d{4})', 'i');
    const match = texto.match(regexComRotulo);
    if (match) return `${match[2]}${match[1]}`;

    // Fallback: Procura qualquer data MM/YYYY
    const regexGlobal = /(\d{2})[/.-](\d{4})/g;
    let m;
    while ((m = regexGlobal.exec(texto)) !== null) {
        // Retorna a primeira data que parece ser uma competência
        return `${m[2]}${m[1]}`;
    }

    return '';
}

/**
 * Abrevia o nome para Primeiro + Último.
 */
export function abreviarNome(nome: string): string {
    if (!nome) return '';
    const preposicoes = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'EM', 'DI']);
    const partes = nome.trim().split(/\s+/).filter(part => !preposicoes.has(part.toUpperCase()));
    if (partes.length <= 2) return partes.join(' ');
    return `${partes[0]} ${partes[partes.length - 1]}`;
}

/**
 * Limpa string para ser usada em nome de arquivo.
 */
export function limparParaArquivo(str: string): string {
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .toUpperCase();
}

/**
 * Preview do processamento inteligente.
 */
export async function previewSmartSplit(
    pdfBytes: Uint8Array,
    config: SmartSplitConfig
): Promise<SmartSplitResult[]> {
    const rawPages = await extractRawPagesText(pdfBytes);

    return rawPages.map((rawText, idx) => {
        const texto = normalizarParaBusca(rawText);

        const nomeRaw = extrairComRotulo(texto, config.rotuloNome);
        const deptoRaw = extrairComRotulo(texto, config.rotuloDepto);
        const periodoRaw = extrairPeriodoRobusto(texto, config.rotuloPeriodo);

        const nomeAbrev = nomeRaw ? abreviarNome(nomeRaw) : '';
        const nomeFinal = nomeAbrev ? limparParaArquivo(nomeAbrev) : '';
        const deptoFinal = deptoRaw ? limparParaArquivo(deptoRaw) : '';
        const periodo = periodoRaw || '';

        const encontrado = !!(nomeFinal && periodo);

        const nomeArquivo = [
            periodo || 'SEM_PERIODO',
            config.empresa,
            config.projeto,
            deptoFinal || 'SEM_DEPTO',
            config.equipe,
            config.tipoDoc,
            nomeFinal || `PAGINA_${idx + 1}`
        ].filter(Boolean).join('_') + '.pdf';

        return {
            nomeArquivo,
            pagina: idx + 1,
            nomeColaborador: nomeRaw || '',
            periodo: periodoRaw || '',
            depto: deptoRaw || '',
            encontrado
        };
    });
}
