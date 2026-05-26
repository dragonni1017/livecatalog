// Minimal type shim for xlsx@0.18.x
// The bundled package.json is missing due to a partial Windows install.
// A full `npm install` on a Linux/Mac system will replace this with proper types.
declare module 'xlsx' {
  export interface WorkSheet {
    [cell: string]: unknown
    '!cols'?: Array<{ wch?: number; wpx?: number }>
    '!rows'?: Array<{ hpx?: number; hpt?: number }>
    '!ref'?: string
    '!merges'?: unknown[]
  }

  export interface WorkBook {
    SheetNames: string[]
    Sheets: { [sheet: string]: WorkSheet }
  }

  export interface ParsingOptions {
    type?: 'base64' | 'binary' | 'buffer' | 'file' | 'array' | 'string'
    raw?: boolean
    codepage?: number
    cellFormula?: boolean
    cellHTML?: boolean
    cellNF?: boolean
    cellStyles?: boolean
    cellText?: boolean
    cellDates?: boolean
    dateNF?: string
    sheetRows?: number
    bookDeps?: boolean
    bookFiles?: boolean
    bookProps?: boolean
    bookSheets?: boolean
    bookVBA?: boolean
    password?: string
    WTF?: boolean
  }

  export interface WritingOptions {
    bookSST?: boolean
    type?: 'base64' | 'binary' | 'buffer' | 'file' | 'array' | 'string'
    cellDates?: boolean
    bookVBA?: boolean
    compression?: boolean
    Props?: unknown
    themeXLSX?: string
  }

  export interface Sheet2JSONOpts {
    raw?: boolean
    range?: unknown
    header?: 'A' | number | string[]
    dateNF?: string
    defval?: unknown
    blankrows?: boolean
  }

  export interface AOA2SheetOpts {
    dateNF?: string
    cellDates?: boolean
    sheetStubs?: boolean
    dense?: boolean
  }

  export namespace utils {
    export function sheet_to_json<T = unknown>(worksheet: WorkSheet, opts?: Sheet2JSONOpts): T[]
    export function aoa_to_sheet(data: unknown[][], opts?: AOA2SheetOpts): WorkSheet
    export function json_to_sheet<T = unknown>(data: T[], opts?: unknown): WorkSheet
    export function book_new(): WorkBook
    export function book_append_sheet(workbook: WorkBook, worksheet: WorkSheet, name?: string): void
    export function encode_cell(cell: { r: number; c: number }): string
    export function decode_cell(address: string): { r: number; c: number }
  }

  export function read(data: unknown, opts?: ParsingOptions): WorkBook
  export function readFile(filename: string, opts?: ParsingOptions): WorkBook
  export function write(data: WorkBook, opts?: WritingOptions): unknown
  export function writeFile(data: WorkBook, filename: string, opts?: WritingOptions): void
  export function writeFileSync(data: WorkBook, filename: string, opts?: WritingOptions): void
}
