import * as pdfjsLib from 'pdfjs-dist';

// Usar worker local via URL pública
pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

export interface SmartSplitConfig {
    empresa: string;
    subId: string;
    equipe: string;
    tipoDoc: string;
    rotuloNome: string;
    rotuloPeriodo: string;
}

export interface SmartSplitResult {
    nomeArquivo: string;
    pagina: number;
    nomeColaborador: string;
    periodo: string;
    encontrado: boolean;
}

export const CONFIG_KEY = 'smartSplitConfig';

export const defaultConfig: SmartSplitConfig = {
    empresa: 'AEDAS',
    subId: 'MRD_ITU_RESP',
    equipe: 'ADM',
    tipoDoc: 'DEMONSTRATIVOS',
    rotuloNome: 'Func.:',
    rotuloPeriodo: 'Período:',
};

export function loadConfig(): SmartSplitConfig {
    try {
        const saved = localStorage.getItem(CONFIG_KEY);
        if (saved) return { ...defaultConfig, ...JSON.parse(saved) };
    } catch {
        // ignore
    }
    return { ...defaultConfig };
}

export function saveConfig(config: SmartSplitConfig) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

/**
 * Extrai texto de todas as páginas do PDF usando PDF.js
 */
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
 * Extrai o nome do colaborador do texto extraído pela página.
 * Tenta casar: <rótulo> <código opcional>  - <nome>
 * Exemplo: "Func.: 052191 - FULANO DOS SANTOS"
 */
function extrairNome(texto: string, rotulo: string): string {
    // Escapa caracteres especiais do rótulo para usar em regex
    const rotuloEsc = rotulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Tenta padrão com código numérico: Func.: 052191 - NOME
    let regex = new RegExp(rotuloEsc + '\\s*[\\d]+\\s*-\\s*([A-ZÀ-Ú][A-ZÀ-Ú\\s]+)', 'i');
    let match = texto.match(regex);
    if (match) return match[1].trim();
    // Tenta padrão sem código: Nome: FULANO DOS SANTOS
    regex = new RegExp(rotuloEsc + '\\s*([A-ZÀ-Ú][A-ZÀ-Ú\\s]+)', 'i');
    match = texto.match(regex);
    if (match) return match[1].trim();
    return '';
}

/**
 * Extrai o período do texto e formata como YYYYMM.
 * Exemplo: "Período: 02/2026" → "202602"
 */
function extrairPeriodo(texto: string, rotulo: string): string {
    const rotuloEsc = rotulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(rotuloEsc + '\\s*(\\d{2})\\/(\\d{4})', 'i');
    const match = texto.match(regex);
    if (match) {
        const mes = match[1];
        const ano = match[2];
        return `${ano}${mes}`;
    }
    return '';
}

/**
 * Normaliza o nome para usar no arquivo: remove acentos, espaços viram _
 */
function normalizarNome(nome: string): string {
    return nome
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '_')
        .replace(/[^A-Za-z0-9_]/g, '')
        .toUpperCase();
}

/**
 * Processa o PDF no modo inteligente: gera preview com os nomes antes do download.
 */
export async function previewSmartSplit(
    pdfBytes: Uint8Array,
    config: SmartSplitConfig
): Promise<SmartSplitResult[]> {
    const pagesText = await extractPagesText(pdfBytes);
    return pagesText.map((texto, idx) => {
        const nomeRaw = extrairNome(texto, config.rotuloNome);
        const periodoRaw = extrairPeriodo(texto, config.rotuloPeriodo);
        const nome = nomeRaw ? normalizarNome(nomeRaw) : '';
        const periodo = periodoRaw || '';
        const encontrado = !!(nome && periodo);

        const prefixos = [
            periodo || 'SEM_PERIODO',
            config.empresa,
            config.subId,
            config.equipe,
            config.tipoDoc,
            nome || `PAGINA_${idx + 1}`,
        ].filter(Boolean).join('_');

        return {
            nomeArquivo: `${prefixos}.pdf`,
            pagina: idx + 1,
            nomeColaborador: nomeRaw || '',
            periodo: periodoRaw || '',
            encontrado,
        };
    });
}
