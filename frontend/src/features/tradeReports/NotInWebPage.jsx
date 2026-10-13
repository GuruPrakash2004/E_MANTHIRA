import { Alert, Card, List, Stack, Text, Title } from '@mantine/core'
import { Info } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import * as tradeApi from '../../api/endpoints/tradeReports'
import { Wrench } from 'lucide-react'
import UtilityBanner from '../../components/ui/UtilityBanner'

/**
 * Menu entries the legacy EXE lists but that cannot show anything for this database. Instead of a dead, greyed link
 * each one opens here and says why, with the live evidence read from the database (counts come from
 * GET /trade-reports/availability, the legacy form name from the decompiled vTemple7.exe).
 */
const ENTRIES = {
  'Daily Sales Report': {
    form: 'frmRptDSR',
    why: 'Reads sales invoices (TrnHdrSINV / TrnDtlSINV), which this temple database does not have. The only related object, the salesreport view, points at those missing tables.',
    evidence: (a) => [`Sales-invoice tables found: ${a.sales_invoice_tables.length}`, `Sales-invoice documents defined (UtlTransactions): ${a.sales_invoice_docs}`],
  },
  'Product Sales Summary Report': {
    form: 'frmRptPdtSLS',
    why: 'Summarises sales invoices by product. There is no sales-invoice document in this database, so there is nothing to summarise.',
    evidence: (a) => [`Sales-invoice tables found: ${a.sales_invoice_tables.length}`, `Sales-invoice documents defined: ${a.sales_invoice_docs}`],
  },
  'Profit Margin': {
    form: 'frmRptProfitMargin',
    why: 'Compares sales-invoice value with item cost. Without sales invoices there is no revenue side to compare.',
    evidence: (a) => [`Sales-invoice tables found: ${a.sales_invoice_tables.length}`],
  },
  'Label Printing': {
    form: 'frmRptLblPrint',
    why: 'Prints labels from layouts saved in the label designer. No label layout has been saved in this database.',
    evidence: (a) => [`Saved label layouts (UtlLBLLayout): ${a.label_layouts}`],
  },
  'Authorise Documents': {
    form: 'fmtUtlAuth',
    why: 'Lists transaction documents that need authorisation. No transaction document is set to require authorisation (only the Customer masters are, and there are no customers).',
    evidence: (a) => [`Transaction documents requiring authorisation: ${a.docs_needing_authorisation}`],
  },
  ShortClosedFields: {
    form: 'frmUtlShortClosedFlds',
    why: 'Configures which fields close a purchase-order style document. No such document is in use.',
    evidence: (a) => [`Short-close field settings: ${a.short_closed_fields}`],
  },
  'ShortClose Documents': {
    form: 'frmUtlShortclose',
    why: 'Short-closes pending quantities on linked documents (e.g. orders). No linked, pending documents exist here.',
    evidence: (a) => [`Short-close field settings: ${a.short_closed_fields}`],
  },
  'Post Doc Entry': {
    form: 'frmUtlPostDocEntry',
    why: 'Posts documents to the books in a batch. This database has no post-document set-ups and every money document posts to the ledger when it is saved.',
    evidence: (a) => [`Post-document entries: ${a.post_doc_entries}`],
  },
  'Shared Documents': {
    form: 'frmUtlSharedDocuments',
    why: 'Shows documents shared between users. Nothing has been shared.',
    evidence: (a) => [`Shared documents: ${a.shared_documents}`],
  },
  'Reminder Alert': {
    form: 'frmDashboard (reminder panel)',
    why: 'Pops up party reminders on the desktop. No reminder messages are defined.',
    evidence: (a) => [`Party alert messages: ${a.party_alert_messages}`],
  },
  'Barcode Layout Format': {
    form: 'frmUtlBCLayoutFmt',
    why: 'Designs barcode label layouts for items. No layout exists.',
    evidence: (a) => [`Barcode layouts: ${a.barcode_layouts}`],
  },
  'Barcode Ammendment': {
    form: 'frmUtlBCAmmendment',
    why: 'Amends barcodes of stock items; it needs barcode layouts and stocked items, and there are none.',
    evidence: (a) => [`Barcode layouts: ${a.barcode_layouts}`],
  },
  'Voice Command Alternatives': {
    form: 'voice-command settings',
    why: 'Maps spoken phrases to desktop menu commands for the Windows app. It controls the desktop menus, so it does not apply to the browser.',
    evidence: (a) => [`Voice command phrases stored: ${a.voice_commands}`],
  },
  'Import Legacy Data': {
    form: 'frmUtlImportLegacyData',
    why: 'A one-time migration tool that reads data from an older version of the software into this database. Run it from the Windows app during a migration; it is not available from the browser.',
    evidence: () => [],
  },
}

export default function NotInWebPage() {
  const [params] = useSearchParams()
  const caption = params.get('c') || ''
  const entry = ENTRIES[caption]
  const { data: avail, isLoading } = useQuery({ queryKey: ['trade-availability'], queryFn: tradeApi.getAvailability, staleTime: 60_000 })

  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner
        title={caption || 'Not available'}
        subtitle="This menu entry has nothing to show for this database"
        heading={caption || 'Not available'}
        sub="Not in the web app"
        facts={entry ? [{ label: 'legacy screen', value: entry.form, text: true }] : []}
        emblem={<Wrench size={60} color="#F4E1A6" strokeWidth={1.4} />}
      />
      <Card withBorder p="lg">
        <Stack gap="sm">
          <Alert color="kumkum" variant="light" icon={<Info size={18} />} title="Why this page is empty">
            <Text size="sm">{entry ? entry.why : 'This entry has no web screen yet.'}</Text>
          </Alert>
          {entry && (
            <>
              <Title order={5}>What the database shows</Title>
              {isLoading || !avail ? (
                <Text size="sm" c="dimmed">Checking...</Text>
              ) : (
                <List size="sm" spacing={4}>
                  {entry.evidence(avail).map((t) => (
                    <List.Item key={t}>{t}</List.Item>
                  ))}
                </List>
              )}
              <Text size="xs" c="dimmed">Legacy screen: {entry.form}</Text>
            </>
          )}
        </Stack>
      </Card>
    </Stack>
  )
}
