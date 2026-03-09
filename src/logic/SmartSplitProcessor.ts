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

/**
 * Extrai e normaliza o texto de todas as páginas.
 * Remove acentos, converte para maiúsculas e limpa espaços extras.
 */
async function extractAndNormalizePages(pdfBytes: Uint8Array): Promise<string[]> {
    const doc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        // Une os blocos com espaço e normaliza tudo
        const rawText = content.items.map((item: any) => item.str).join(' ');
        const normalized = rawText
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove acentos
            .replace(/\s+/g, ' ')            // Remove espaços extras/novas linhas
            .toUpperCase()
            .trim();
        pages.push(normalized);
    }
    return pages;
}

/**
 * Escapa o rótulo e permite que o dois pontos seja opcional.
 */
function prepararRotulo(rotulo: string): string {
    return rotulo
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(':', '\\s*[:]?');
}

/**
 * Extrai um campo (Nome ou Depto) baseado no rótulo.
 * Aceita opcionalmente um código numérico antes do valor.
 */
function extrairCampo(texto: string, rotulo: string): string {
    const rotEsc = prepararRotulo(rotulo);
    // Regex: Procura o rótulo, pula o código (se houver), captura o texto.
    // Para no próximo rótulo provável (Palavra seguida de :) ou em uma data (00/0000).
    const regex = new RegExp(
        rotEsc + '\\s*(?:\\d+\\s*-\\s*)?([^:]{2,60}?)(?=\\s+[A-Z]{3,15}\\s*[:]|\\d{2}/\\d{4}|\\s*$)',
        'i'
    );
    const match = texto.match(regex);
    if (match) {
        let val = match[1].trim();
        // Remove lixo comum no final se a regex foi gulosa demais
        return val.replace(/\s+[A-Z]{3,10}:.*$/, '').trim();
    }
    return '';
}

/**
 * Extrai o período (MM/AAAA) e retorna AAAAMM.
 */
function extrairPeriodo(texto: string, rotulo: string): string {
    const rotEsc = prepararRotulo(rotulo);
    // Tenta primeiro com o rótulo específico
    const regex = new RegExp(rotEsc + '\\s*(\\d{2})\\s*[/\\\\-\\.]\\s*(\\d{4})', 'i');
    let match = texto.match(regex);
    if (match) return `${match[2]}${match[1]}`;

    // Fallback: procura a primeira ocorrência de MM/AAAA que pareça uma competência
    const fallback = /(\d{2})[/\-\.](\d{4})/g;
    let feb;
    while ((feb = fallback.exec(texto)) !== null) {
        // Retorna a primeira data encontrada como período
        return `${feb[2]}${feb[1]}`;
    }
    return '';
}

/**
 * Abrevia o nome para PRIMEIRO + ÚLTIMO nome.
 */
export function abreviarNome(nome: string): string {
    if (!nome) return '';
    const preposicoes = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'EM', 'DI']);
    const partes = nome.trim().split(/\s+/).filter(p => p.length > 2 && !preposicoes.has(p.toUpperCase()));
    if (partes.length === 0) return nome;
    if (partes.length === 1) return partes[0];
    return `${partes[0]} ${partes[partes.length - 1]}`;
}

/**
 * Normaliza string para nome de arquivo (seguro).
 */
export function normalizarParaArquivo(texto: string): string {
    return texto
        .replace(/\s+/g, '_')
        .replace(/[^A-Za-z0-9_]/g, '')
        .toUpperCase();
}

/**
 * Processamento principal para gerar o preview.
 */
export async function previewSmartSplit(
    pdfBytes: Uint8Array,
    config: SmartSplitConfig
): Promise<SmartSplitResult[]> {
    const pagesText = await extractAndNormalizePages(pdfBytes);

    return pagesText.map((texto, idx) => {
        // Extração dos campos brutos
        let nomeRaw = extrairCampo(texto, config.rotuloNome);
        let deptoRaw = extrairCampo(texto, config.rotuloDepto);
        const periodoRaw = extrairPeriodo(texto, config.rotuloPeriodo);

        // Debug simples: Se o nome cair no depto (comum em extrações bagunçadas), tenta inverter
        // mas aqui vamos apenas garantir que o nome seja abreviado e limpo.

        const nomeAbrev = nomeRaw ? abreviarNome(nomeRaw) : '';
        const nomeNorm = nomeAbrev ? normalizarParaArquivo(nomeAbrev) : '';
        const deptoNorm = deptoRaw ? normalizarParaArquivo(deptoRaw) : '';
        const periodo = periodoRaw || '';

        const encontrado = !!(nomeNorm && periodo);

        const prefixos = [
            periodo || 'SEM_PERIODO',
            config.empresa,
            config.projeto,
            deptoNorm || 'SEM_DEPTO',
            config.equipe,
            config.tipoDoc,
            nomeNorm || `PAGINA_${idx + 1}`,
        ].join('_');

        return {
            nomeArquivo: `${prefixos}.pdf`,
            pagina: idx + 1,
            nomeColaborador: nomeRaw || '',
            periodo: periodoRaw || '',
            depto: deptoRaw || '',
            encontrado,
        };
    });
}
