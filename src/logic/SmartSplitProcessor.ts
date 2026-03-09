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

// Lista de rótulos comuns em contracheques para servir de delimitadores de campo
const LABELS_DELIMITADORES = [
    'Func.:', 'Func:', 'Periodo:', 'Período:', 'Depto.:', 'Depto:',
    'Cargo:', 'Matricula:', 'Matrícula:', 'CTPS:', 'Admissão:', 'Admissao:', 'CPF:'
];

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
 * Estratégia baseada em posição:
 * 1. Mapeia todas as ocorrências de todos os rótulos conhecidos no texto.
 * 2. O valor de um rótulo é o texto entre ele e o próximo rótulo da lista.
 */
function extrairCamposPorPosicao(texto: string, config: SmartSplitConfig): { nome: string, depto: string, periodo: string } {
    const textoNorm = normalizarParaBusca(texto);

    // Lista de todos os rótulos a monitorar (configurados + genéricos)
    const todosLabels = Array.from(new Set([
        ...LABELS_DELIMITADORES,
        config.rotuloNome,
        config.rotuloDepto,
        config.rotuloPeriodo
    ])).map(l => normalizarParaBusca(l));

    // Encontra todas as posições [posicao, tamanho_label, label_norm]
    const ocorrencias: { pos: number, len: number, label: string }[] = [];
    todosLabels.forEach(label => {
        // Regex para encontrar o label (com : opcional se for o caso)
        const lEsc = escaparParaRegex(label).replace(':', '[:]?');
        const regex = new RegExp(lEsc, 'gi');
        let m;
        while ((m = regex.exec(textoNorm)) !== null) {
            ocorrencias.push({ pos: m.index, len: m[0].length, label });
        }
    });

    // Ordena por posição no texto
    ocorrencias.sort((a, b) => a.pos - b.pos);

    const obterValor = (labelAlvo: string): string => {
        const targetNorm = normalizarParaBusca(labelAlvo);
        const alvoOcorrencias = ocorrencias
            .map((o, i) => o.label === targetNorm ? i : -1)
            .filter(i => i !== -1);

        for (const idx of alvoOcorrencias) {
            const start = ocorrencias[idx].pos + ocorrencias[idx].len;
            // O fim é a posição da próxima ocorrência, ou o fim do texto
            const end = (idx + 1 < ocorrencias.length) ? ocorrencias[idx + 1].pos : textoNorm.length;

            let val = textoNorm.substring(start, end).trim();

            // Limpeza básica: remove código inicial (ex: "001 - ")
            val = val.replace(/^\d+\s*[-]\s*/, '').trim();

            // Se o valor extraído for vazio ou for apenas outro label conhecido, ignora esta ocorrência
            const valNorm = normalizarParaBusca(val);
            const ehLabel = todosLabels.some(l => valNorm === l || valNorm.startsWith(l));

            if (val && !ehLabel) {
                return val;
            }
        }

        return '';
    };

    const nome = obterValor(config.rotuloNome);
    const depto = obterValor(config.rotuloDepto);

    // Período específico
    let periodoRaw = obterValor(config.rotuloPeriodo);
    // Validação de MM/YYYY no período extraído
    const matchData = periodoRaw.match(/(0[1-9]|1[0-2])[/.-](20\d{2})/);
    let periodo = matchData ? `${matchData[2]}${matchData[1]}` : '';

    // Fallback de período se não encontrou pelo rótulo ou se ficou vazio
    if (!periodo) {
        const regexFallback = /(0[1-9]|1[0-2])[/.-](20\d{2})/g;
        let m;
        while ((m = regexFallback.exec(textoNorm)) !== null) {
            periodo = `${m[2]}${m[1]}`;
            break; // Pega a primeira data válida
        }
    }

    return { nome, depto, periodo };
}

export function abreviarNome(nome: string): string {
    if (!nome) return '';
    const preposicoes = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'EM', 'DI']);
    const partes = nome.trim().split(/\s+/).filter(part => part.length > 2 && !preposicoes.has(part.toUpperCase()));
    if (partes.length <= 2) return partes.join(' ');
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
        const { nome, depto, periodo } = extrairCamposPorPosicao(rawText, config);

        const nomeAbrev = nome ? abreviarNome(nome) : '';
        const nomeFinal = nomeAbrev ? limparParaArquivo(nomeAbrev) : '';

        const deptoAbrev = depto ? abreviarDepto(depto) : '';
        const deptoFinal = deptoAbrev ? limparParaArquivo(deptoAbrev) : '';

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
            nomeColaborador: nome || '',
            periodo: periodo || '',
            depto: depto || '',
            encontrado
        };
    });
}
