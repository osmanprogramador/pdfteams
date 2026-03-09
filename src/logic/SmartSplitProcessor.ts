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

// Mapeamento de abreviações de departamentos
const DEPT_MAPPING: Record<string, string> = {
    'PROJETO ITUETA E RESPLENDOR': 'ITU_RESP',
    'PROJETO CONSELHEIRO PENA': 'CONS_PENA',
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

function normalizarParaBusca(texto: string): string {
    return texto
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .toUpperCase()
        .trim();
}

function escaparParaRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extração de campo via RegEx robusta com delimitação por rótulos prováveis.
 */
function extrairCampo(texto: string, rotulo: string): string {
    if (!rotulo) return '';
    const textoNorm = normalizarParaBusca(texto);
    const rotNorm = normalizarParaBusca(rotulo);

    // Escapa o rótulo e permite flexibilidade com pontos e dois-pontos
    // Remove o sinal final do rótulo para fazer busca flexível
    const rBase = rotNorm.replace(/[:.]$/, '');
    const escaped = escaparParaRegex(rBase) + '[.:]?\\s*[:]?';

    // Procura o rótulo e captura tudo até o próximo rótulo provável
    // Delimitadores: Palavra capitalizada seguida de dois pontos (ex: "Cargo:"), data ou fim de linha
    const regex = new RegExp(escaped + '\\s*([^:]+?)(?=\\s+[A-Z][a-z]{2,15}\\s*[:]|$|\\s*[A-Z]{3,15}\\s*[:]|\\s*\\d{2}[/.-]\\d{4})', 'i');

    // Tenta encontrar todas as ocorrências e pega a que parece conter um valor real (não outro rótulo)
    const matches = Array.from(textoNorm.matchAll(new RegExp(regex, 'gi')));

    for (const match of matches) {
        let val = match[1].trim();

        // Se capturou o próprio rótulo (fragmentado), tenta limpar ou pula
        if (val.includes(rotNorm.replace(/:/g, ''))) {
            val = val.split(rotNorm.replace(/:/g, '')).pop()!.trim();
        }

        // Limpeza profunda:
        // 1. Remove códigos iniciais ("001 - ", "123.456 - ")
        val = val.replace(/^[\d.-]+\s*[-/]\s*/, '').trim();
        // 2. Remove pontuação residual no início
        val = val.replace(/^[:.-]+\s*/, '').trim();

        // Verifica se o valor não é apenas outro rótulo provável
        if (val && val.length > 2 && !val.endsWith(':')) {
            return val;
        }
    }

    return '';
}

function extrairPeriodoRobusto(texto: string, rotulo: string): string {
    const textoNorm = normalizarParaBusca(texto);
    const rotNorm = normalizarParaBusca(rotulo);

    const rBase = rotNorm.replace(/[:.]$/, '');
    const escaped = escaparParaRegex(rBase) + '[.:]?\\s*[:]?';

    const regexComRotulo = new RegExp(escaped + '\\s*(0[1-9]|1[0-2])\\s*[/.-]\\s*(20\\d{2})', 'i');
    const match = textoNorm.match(regexComRotulo);
    if (match) return `${match[2]}${match[1]}`;

    // Fallback: Procura qualquer data MM/YYYY no texto
    const regexGlobal = /(0[1-9]|1[0-2])[/.-](20\d{2})/g;
    let m;
    while ((m = regexGlobal.exec(textoNorm)) !== null) {
        return `${m[2]}${m[1]}`;
    }

    return '';
}

export function abreviarNome(nome: string): string {
    if (!nome) return '';
    const preposicoes = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'EM', 'DI']);
    const partes = nome.trim().split(/\s+/).filter(part => part.length > 2 && !preposicoes.has(part.toUpperCase()));
    if (partes.length === 0) return nome;
    if (partes.length === 1) return partes[0];
    return `${partes[0]} ${partes[partes.length - 1]}`;
}

function abreviarDepto(depto: string): string {
    const d = depto.trim().toUpperCase();
    return DEPT_MAPPING[d] || depto;
}

export function limparParaArquivo(str: string): string {
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .toUpperCase();
}

export async function previewSmartSplit(
    pdfBytes: Uint8Array,
    config: SmartSplitConfig
): Promise<SmartSplitResult[]> {
    const rawPages = await extractRawPagesText(pdfBytes);

    return rawPages.map((rawText, idx) => {
        const nomeRaw = extrairCampo(rawText, config.rotuloNome);
        const deptoRaw = extrairCampo(rawText, config.rotuloDepto);
        const periodoRaw = extrairPeriodoRobusto(rawText, config.rotuloPeriodo);

        const nomeAbrev = nomeRaw ? abreviarNome(nomeRaw) : '';
        const nomeFinal = nomeAbrev ? limparParaArquivo(nomeAbrev) : '';

        const deptoAbrev = deptoRaw ? abreviarDepto(deptoRaw) : '';
        const deptoFinal = deptoAbrev ? limparParaArquivo(deptoAbrev) : '';

        const encontrado = !!(nomeFinal && periodoRaw);

        const nomeArquivo = [
            periodoRaw || 'SEM_PERIODO',
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
