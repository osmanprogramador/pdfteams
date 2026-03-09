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
 * Extrai um campo baseado em um rótulo de forma robusta.
 * Pega um bloco de texto após o rótulo e corta no próximo rótulo provável.
 */
function extrairComRotulo(texto: string, rotulo: string, outrosRotulos: string[]): string {
    const rotNorm = normalizarParaBusca(rotulo);
    const rotEsc = escaparParaRegex(rotNorm).replace(':', '[:]?');

    // Procura a posição do rótulo
    const regexRot = new RegExp(rotEsc, 'i');
    const matchRot = texto.match(regexRot);
    if (!matchRot || matchRot.index === undefined) return '';

    // Pega os 120 caracteres após o rótulo
    let bloco = texto.substring(matchRot.index + matchRot[0].length).trim();
    if (bloco.length > 120) bloco = bloco.substring(0, 120);

    // Remove código inicial se houver (ex: "000150 - ")
    bloco = bloco.replace(/^\d+\s*-\s*/, '').trim();

    // Identifica onde parar: próximo rótulo provável (Palavra: ) ou uma data
    // Vamos usar os outros rótulos da config como delimitadores fortes
    const delimitadores = outrosRotulos.map(r => normalizarParaBusca(r).replace(':', ''));

    // Procura a primeira ocorrência de qualquer delimitador ou de "PALAVRA:"
    let indexCorte = bloco.length;

    // Próximo rótulo genérico (Palavra de 3-15 letras seguida de dois pontos)
    const nextLabelMatch = bloco.match(/\s+[A-Z]{3,15}\s*[:]/);
    if (nextLabelMatch && nextLabelMatch.index !== undefined) {
        indexCorte = Math.min(indexCorte, nextLabelMatch.index);
    }

    // Datas MM/YYYY também são delimitadores
    const dateMatch = bloco.match(/\d{2}[/.-]\d{4}/);
    if (dateMatch && dateMatch.index !== undefined) {
        indexCorte = Math.min(indexCorte, dateMatch.index);
    }

    // Delimitadores específicos da config
    delimitadores.forEach(d => {
        const dEsc = escaparParaRegex(d);
        const dMatch = bloco.match(new RegExp('\\s+' + dEsc, 'i'));
        if (dMatch && dMatch.index !== undefined) {
            indexCorte = Math.min(indexCorte, dMatch.index);
        }
    });

    return bloco.substring(0, indexCorte).trim();
}

/**
 * Extrai o período (MM/YYYY) e converte para YYYYMM.
 * Filtra apenas datas que parecem ser competências válidas (mes 01-12, ano 2000-2099).
 */
function extrairPeriodoRobusto(texto: string, rotulo: string): string {
    const rotNorm = normalizarParaBusca(rotulo);
    const rotEsc = escaparParaRegex(rotNorm).replace(':', '[:]?');

    // Tenta primeiro com o rótulo
    const regexComRotulo = new RegExp(rotEsc + '\\s*(0[1-9]|1[0-2])\\s*[/.-]\\s*(20\\d{2})', 'i');
    const match = texto.match(regexComRotulo);
    if (match) return `${match[2]}${match[1]}`;

    // Fallback: Procura qualquer data MM/YYYY válida no texto
    const regexGlobal = /(0[1-9]|1[0-2])[/.-](20\d{2})/g;
    let m;
    while ((m = regexGlobal.exec(texto)) !== null) {
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
    const partes = nome.trim().split(/\s+/).filter(part => part.length > 2 && !preposicoes.has(part.toUpperCase()));
    if (partes.length === 0) return nome;
    if (partes.length === 1) return partes[0];
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
    const codigosCampos = [config.rotuloNome, config.rotuloDepto, config.rotuloPeriodo];

    return rawPages.map((rawText, idx) => {
        const texto = normalizarParaBusca(rawText);

        const nomeRaw = extrairComRotulo(texto, config.rotuloNome, codigosCampos);
        const deptoRaw = extrairComRotulo(texto, config.rotuloDepto, codigosCampos);
        const periodoRaw = extrairPeriodoRobusto(texto, config.rotuloPeriodo);

        const nomeAbrev = nomeRaw ? abreviarNome(nomeRaw) : '';
        const nomeFinal = nomeAbrev ? limparParaArquivo(nomeAbrev) : '';
        const deptoFinal = deptoRaw ? limparParaArquivo(deptoRaw) : '';
        const periodo = periodoRaw || '';

        // Só considera como "encontrado" se tiver o nome e o período
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
