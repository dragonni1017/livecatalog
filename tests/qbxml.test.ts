import { describe, it, expect } from 'vitest'
import {
  buildCustomerAddRq,
  buildCustomerQueryRq,
  buildItemAddRq,
  buildItemQueryRq,
  buildSalesOrderAddRq,
  isNotFoundStatus,
  parseCustomerAddRs,
  parseCustomerQueryRs,
  parseItemAddRs,
  parseItemQueryRs,
  parseSalesOrderAddRs,
  xmlEscape,
} from '@/lib/qbxml'

describe('xmlEscape', () => {
  it('escapes the five XML-significant characters', () => {
    expect(xmlEscape(`<a> & "b" 'c'`)).toBe('&lt;a&gt; &amp; &quot;b&quot; \'c\'')
  })
})

describe('buildCustomerQueryRq', () => {
  it('wraps the name in a qbXML CustomerQueryRq filtered by FullName', () => {
    const xml = buildCustomerQueryRq('Acme Wholesale')
    expect(xml).toContain('<?qbxml version="13.0"?>')
    expect(xml).toContain('<CustomerQueryRq requestID="1"><FullName>Acme Wholesale</FullName></CustomerQueryRq>')
  })

  it('escapes special characters in the name (apostrophes are left as-is — safe in element text)', () => {
    const xml = buildCustomerQueryRq(`Bob's "Toys" & Co`)
    expect(xml).toContain(`Bob's &quot;Toys&quot; &amp; Co`)
  })
})

describe('buildItemQueryRq', () => {
  it('wraps the SKU in a qbXML ItemQueryRq filtered by FullName', () => {
    const xml = buildItemQueryRq('ABC-123')
    expect(xml).toContain('<ItemQueryRq requestID="1"><FullName>ABC-123</FullName></ItemQueryRq>')
  })
})

describe('buildSalesOrderAddRq', () => {
  it('builds a SalesOrderAdd with customer ref, PO number, and one line per item', () => {
    const xml = buildSalesOrderAddRq({
      qbCustomerListId: '80000073-1234567890',
      refNumber: 'ORD-2026-0011',
      poNumber: 'PO-999',
      lines: [
        { qbItemListId: '50000001-1111111111', desc: '3D Printed Snakes', qty: 4, rateCents: 125 },
        { qbItemListId: '50000002-2222222222', desc: '3D Printed Snake Eggs', qty: 2, rateCents: 250 },
      ],
    })
    expect(xml).toContain('<SalesOrderAddRq requestID="1">')
    expect(xml).toContain('<CustomerRef><ListID>80000073-1234567890</ListID></CustomerRef>')
    expect(xml).toContain('<RefNumber>ORD-2026-0011</RefNumber>')
    expect(xml).toContain('<PONumber>PO-999</PONumber>')
    expect(xml).toContain('<ItemRef><ListID>50000001-1111111111</ListID></ItemRef>')
    expect(xml).toContain('<Quantity>4</Quantity>')
    expect(xml).toContain('<Rate>1.25</Rate>')
    expect(xml).toContain('<ItemRef><ListID>50000002-2222222222</ListID></ItemRef>')
    expect(xml).toContain('<Rate>2.50</Rate>')
  })

  it('omits PONumber entirely when none is given', () => {
    const xml = buildSalesOrderAddRq({
      qbCustomerListId: 'X',
      refNumber: 'ORD-2026-0012',
      poNumber: null,
      lines: [{ qbItemListId: 'Y', desc: 'Item', qty: 1, rateCents: 100 }],
    })
    expect(xml).not.toContain('PONumber')
  })
})

describe('parseCustomerQueryRs', () => {
  it('extracts ListID and FullName on a successful single-match response', () => {
    const xml = `<?xml version="1.0"?><QBXML><QBXMLMsgsRs>
      <CustomerQueryRs requestID="1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">
        <CustomerRet><ListID>80000073-1234567890</ListID><FullName>Acme Wholesale</FullName></CustomerRet>
      </CustomerQueryRs>
    </QBXMLMsgsRs></QBXML>`
    const result = parseCustomerQueryRs(xml)
    expect(result.status.ok).toBe(true)
    expect(result.status.code).toBe(0)
    expect(result.listId).toBe('80000073-1234567890')
    expect(result.fullName).toBe('Acme Wholesale')
  })

  it('takes the first match when QuickBooks returns multiple customers', () => {
    const xml = `<?xml version="1.0"?><QBXML><QBXMLMsgsRs>
      <CustomerQueryRs requestID="1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">
        <CustomerRet><ListID>FIRST</ListID><FullName>Acme A</FullName></CustomerRet>
        <CustomerRet><ListID>SECOND</ListID><FullName>Acme B</FullName></CustomerRet>
      </CustomerQueryRs>
    </QBXMLMsgsRs></QBXML>`
    const result = parseCustomerQueryRs(xml)
    expect(result.listId).toBe('FIRST')
  })

  it('reports a non-ok status with no listId on a QuickBooks error (e.g. no match)', () => {
    const xml = `<?xml version="1.0"?><QBXML><QBXMLMsgsRs>
      <CustomerQueryRs requestID="1" statusCode="500" statusSeverity="Warn" statusMessage="Nothing was returned">
      </CustomerQueryRs>
    </QBXMLMsgsRs></QBXML>`
    const result = parseCustomerQueryRs(xml)
    expect(result.status.ok).toBe(false)
    expect(result.status.code).toBe(500)
    expect(result.status.message).toBe('Nothing was returned')
    expect(result.listId).toBeUndefined()
  })
})

describe('parseItemQueryRs', () => {
  it('finds the *Ret element regardless of QuickBooks item type', () => {
    const xml = `<?xml version="1.0"?><QBXML><QBXMLMsgsRs>
      <ItemQueryRs requestID="1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">
        <ItemNonInventoryRet><ListID>50000001-1111111111</ListID><FullName>ABC-123</FullName></ItemNonInventoryRet>
      </ItemQueryRs>
    </QBXMLMsgsRs></QBXML>`
    const result = parseItemQueryRs(xml)
    expect(result.status.ok).toBe(true)
    expect(result.listId).toBe('50000001-1111111111')
    expect(result.fullName).toBe('ABC-123')
  })
})

describe('isNotFoundStatus', () => {
  it('is true only for statusCode 500 (qbXML "no match" on a name-filtered query)', () => {
    expect(isNotFoundStatus({ code: 500, severity: 'Warn', message: '', ok: false })).toBe(true)
    expect(isNotFoundStatus({ code: 0, severity: 'Info', message: '', ok: true })).toBe(false)
    expect(isNotFoundStatus({ code: 3140, severity: 'Error', message: '', ok: false })).toBe(false)
  })
})

describe('buildCustomerAddRq', () => {
  it('wraps the name in a qbXML CustomerAddRq', () => {
    const xml = buildCustomerAddRq('QBWC Test 1')
    expect(xml).toContain('<CustomerAddRq requestID="1"><CustomerAdd><Name>QBWC Test 1</Name></CustomerAdd></CustomerAddRq>')
  })
})

describe('buildItemAddRq', () => {
  it('builds an ItemNonInventoryAddRq with the given SKU as Name and the income account', () => {
    const xml = buildItemAddRq('3D801155', 'Sales Orders')
    expect(xml).toContain('<ItemNonInventoryAddRq requestID="1">')
    expect(xml).toContain('<Name>3D801155</Name>')
    expect(xml).toContain('<IncomeAccountRef><FullName>Sales Orders</FullName></IncomeAccountRef>')
  })
})

describe('parseCustomerAddRs', () => {
  it('extracts ListID and FullName on success', () => {
    const xml = `<?xml version="1.0"?><QBXML><QBXMLMsgsRs>
      <CustomerAddRs requestID="1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">
        <CustomerRet><ListID>80000099-1111111111</ListID><FullName>QBWC Test 1</FullName></CustomerRet>
      </CustomerAddRs>
    </QBXMLMsgsRs></QBXML>`
    const result = parseCustomerAddRs(xml)
    expect(result.status.ok).toBe(true)
    expect(result.listId).toBe('80000099-1111111111')
    expect(result.fullName).toBe('QBWC Test 1')
  })
})

describe('parseItemAddRs', () => {
  it('extracts ListID and FullName on success', () => {
    const xml = `<?xml version="1.0"?><QBXML><QBXMLMsgsRs>
      <ItemNonInventoryAddRs requestID="1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">
        <ItemNonInventoryRet><ListID>50000099-2222222222</ListID><FullName>3D801155</FullName></ItemNonInventoryRet>
      </ItemNonInventoryAddRs>
    </QBXMLMsgsRs></QBXML>`
    const result = parseItemAddRs(xml)
    expect(result.status.ok).toBe(true)
    expect(result.listId).toBe('50000099-2222222222')
    expect(result.fullName).toBe('3D801155')
  })

  it('reports failure when the account reference is invalid', () => {
    const xml = `<?xml version="1.0"?><QBXML><QBXMLMsgsRs>
      <ItemNonInventoryAddRs requestID="1" statusCode="3210" statusSeverity="Error" statusMessage="Invalid account">
      </ItemNonInventoryAddRs>
    </QBXMLMsgsRs></QBXML>`
    const result = parseItemAddRs(xml)
    expect(result.status.ok).toBe(false)
    expect(result.listId).toBeUndefined()
  })
})

describe('parseSalesOrderAddRs', () => {
  it('extracts the TxnID on success', () => {
    const xml = `<?xml version="1.0"?><QBXML><QBXMLMsgsRs>
      <SalesOrderAddRs requestID="1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">
        <SalesOrderRet><TxnID>ABC-TXN-1</TxnID><RefNumber>ORD-2026-0011</RefNumber></SalesOrderRet>
      </SalesOrderAddRs>
    </QBXMLMsgsRs></QBXML>`
    const result = parseSalesOrderAddRs(xml)
    expect(result.status.ok).toBe(true)
    expect(result.txnId).toBe('ABC-TXN-1')
  })

  it('reports failure with no txnId when QuickBooks rejects the request', () => {
    const xml = `<?xml version="1.0"?><QBXML><QBXMLMsgsRs>
      <SalesOrderAddRs requestID="1" statusCode="3140" statusSeverity="Error" statusMessage="Invalid reference to ListID">
      </SalesOrderAddRs>
    </QBXMLMsgsRs></QBXML>`
    const result = parseSalesOrderAddRs(xml)
    expect(result.status.ok).toBe(false)
    expect(result.status.code).toBe(3140)
    expect(result.txnId).toBeUndefined()
  })
})
