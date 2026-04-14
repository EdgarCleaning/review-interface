'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

// ── Types ──────────────────────────────────────────────────────────────────────

interface FlaggedJob {
  id: string
  address: string
  work_type: string
  walk: string | null
  scheduled_date: string
  scheduled_time: string | null
  status: string
  flag_reason: string | null
  created_at: string
  builder_id: string
  builder_name: string | null
  subdivision_id: string | null
  subdivision_name: string | null
  division: string | null
  subcontractor_name: string | null
  po_id: string | null
  po_number: string | null
  po_amount: number | null
  po_clean_type: string | null
  po_match_score: number | null
  requester: string | null
  instructions: string | null
  source_email_id: string | null
  source_email_body: string | null
}

interface JobHistory {
  work_type: string
  walk: string | null
  scheduled_date: string
  status: string
  subcontractor_name: string | null
}

interface JobEdits {
  address: string
  work_type: string
  walk: string
}

interface PoResult {
  id: string
  po_number: string
  address: string | null
  amount: number | null
  clean_type: string | null
  score: number
}

type SortField = 'date_received' | 'scheduled_date' | 'builder' | 'work_type' | 'flag_reason_category'
type SortDir = 'asc' | 'desc'
interface SortTier { field: SortField; dir: SortDir }

// ── Constants ──────────────────────────────────────────────────────────────────

const BUILDER_COLORS: Record<string, string> = {
  'DR Horton':  '#2563EB',
  'Stylecraft': '#059669',
  'Castlerock': '#DC2626',
  'Omega':      '#D97706',
}

const WORK_TYPE_BADGES: Record<string, { bg: string; text: string }> = {
  'Rough':        { bg: '#DBEAFE', text: '#1E40AF' },
  'Final':        { bg: '#D1FAE5', text: '#065F46' },
  'Touch Up':     { bg: '#FEF3C7', text: '#92400E' },
  'Power Wash':   { bg: '#E0E7FF', text: '#3730A3' },
  'Windows Redo': { bg: '#FCE7F3', text: '#9D174D' },
  'XTR':          { bg: '#F0FDF4', text: '#166534' },
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  unscheduled: { bg: '#F3F4F6', text: '#6B7280' },
  scheduled:   { bg: '#DBEAFE', text: '#1E40AF' },
  complete:    { bg: '#D1FAE5', text: '#065F46' },
  flagged:     { bg: '#FEF3C7', text: '#92400E' },
  rejected:    { bg: '#FEE2E2', text: '#991B1B' },
}

const WORK_TYPES = ['Rough', 'Final', 'Touch Up', 'Power Wash', 'Windows Redo', 'XTR'] as const

const WORK_TYPE_FILTER_OPTIONS = ['Rough', 'Final', 'Touch Up', 'Power Wash', 'Windows Redo', 'XTR', 'Orientation']

const BUILDER_WALKS: Record<string, string[]> = {
  'DR Horton':  ['Rough', 'Final', 'Buyer Walk', 'Rewalk', 'Closing', 'XTR', 'Power Wash'],
  'Castlerock': ['Clean 1', 'Clean 2', 'Clean 3', 'Clean 4', 'XTR', 'Power Wash'],
  'Omega':      ['Rough', 'Final', 'Touch Up', 'XTR', 'Power Wash'],
  'Stylecraft': ['Clean 1', 'Clean 2', 'Orientation', 'Confirmation', 'Closing', 'XTR', 'Power Wash'],
}

const ALL_WALKS = [
  'Rough', 'Final', 'Buyer Walk', 'Rewalk', 'Closing',
  'Clean 1', 'Clean 2', 'Clean 3', 'Clean 4',
  'Touch Up', 'Orientation', 'Confirmation',
  'XTR', 'Power Wash',
]

const FLAG_REASON_CATEGORIES = [
  { val: 'address',       label: 'Address Issues'  },
  { val: 'prerequisites', label: 'Prerequisites'   },
  { val: 'duplicates',    label: 'Duplicates'      },
  { val: 'auto-created',  label: 'Auto-Created'    },
]

const SORT_FIELD_LABELS: Record<SortField, string> = {
  date_received:        'Date Received',
  scheduled_date:       'Scheduled Date',
  builder:              'Builder',
  work_type:            'Work Type',
  flag_reason_category: 'Flag Reason',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getFlagReasons(flagReason: string | null): string[] {
  if (!flagReason) return []
  return flagReason.split(' | ').filter(Boolean)
}

function categorizeFlagReason(reason: string): string {
  const r = reason.toLowerCase()
  if (r.includes('address') || r.includes('fuzzy') || r.includes('not found in po')) return 'address'
  if (r.includes('prerequisite')) return 'prerequisites'
  if (r.includes('already completed')) return 'duplicates'
  if (r.includes('auto-created') || r.includes('auto-scheduled')) return 'auto-created'
  return 'other'
}

function getPrimaryCategory(flagReason: string | null): string {
  if (!flagReason) return 'other'
  const reasons = getFlagReasons(flagReason)
  return reasons.length ? categorizeFlagReason(reasons[0]) : 'other'
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function timeAgo(dateStr: string): string {
  const diff  = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days  = Math.floor(hours / 24)
  if (mins < 2)   return 'Just now'
  if (hours < 1)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

function scoreColor(score: number): string {
  if (score >= 0.8) return '#059669'
  if (score >= 0.5) return '#D97706'
  return '#DC2626'
}

function flaggedToday(createdAt: string): boolean {
  const today = new Date().toISOString().split('T')[0]
  return new Date(createdAt).toISOString().split('T')[0] === today
}

function scheduledFuture(scheduledDate: string): boolean {
  const today = new Date().toISOString().split('T')[0]
  return scheduledDate > today
}

// Token-overlap similarity for fuzzy PO address matching
function addressSimilarity(a: string, b: string): number {
  const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean))
  const aT = tokens(a)
  const bT = tokens(b)
  let overlap = 0
  for (const t of aT) if (bT.has(t)) overlap++
  const union = new Set([...aT, ...bT]).size
  return union === 0 ? 0 : overlap / union
}

function hasNoPoMatchFlag(flagReason: string | null): boolean {
  if (!flagReason) return false
  const r = flagReason.toLowerCase()
  return r.includes('not found in po') || r.includes('fuzzy match') || r.includes('address not found')
}

// ── Reusable pieces ────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#1F2937' }}>{value ?? '—'}</div>
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
        border: active ? 'none' : '1px solid #E5E7EB',
        background: active ? '#1F2937' : '#fff',
        color: active ? '#fff' : '#6B7280',
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: '#9CA3AF',
      textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12,
    }}>
      {children}
    </div>
  )
}

function EditedBadge() {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color: '#2563EB',
      background: '#EFF6FF', border: '1px solid #BFDBFE',
      borderRadius: 4, padding: '1px 5px', marginLeft: 6,
    }}>
      edited
    </span>
  )
}

function FilterGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color: '#D1D5DB',
      textTransform: 'uppercase', letterSpacing: 0.5,
      flexShrink: 0, marginRight: 2,
    }}>
      {children}
    </span>
  )
}

function FilterDivider() {
  return <span style={{ width: 1, height: 16, background: '#E5E7EB', margin: '0 6px', display: 'inline-block', flexShrink: 0 }} />
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ReviewQueue() {
  const router = useRouter()

  // Core data
  const [jobs, setJobs] = useState<FlaggedJob[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)

  // UI state
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  // Filters
  const [builderFilter, setBuilderFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'upcoming'>('all')
  const [workTypeFilter, setWorkTypeFilter] = useState('all')
  const [walkFilter, setWalkFilter] = useState('all')
  const [flagReasonFilter, setFlagReasonFilter] = useState('all')

  // Sort
  const [sortTiers, setSortTiers] = useState<SortTier[]>([])
  const [showSortPopover, setShowSortPopover] = useState(false)
  const [pendingSortField, setPendingSortField] = useState<SortField>('date_received')
  const [pendingSortDir, setPendingSortDir] = useState<SortDir>('asc')

  // History
  const [historyMap, setHistoryMap] = useState<Record<string, JobHistory[]>>({})
  const [historyLoading, setHistoryLoading] = useState<Set<string>>(new Set())

  // PO matching
  const [poResultsMap, setPoResultsMap] = useState<Record<string, PoResult[]>>({})
  const [poLoadingSet, setPoLoadingSet] = useState<Set<string>>(new Set())
  const [poRunDone, setPoRunDone] = useState<Set<string>>(new Set())
  const [selectedPoMap, setSelectedPoMap] = useState<Record<string, string | null>>({})

  // Per-card actions
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set())

  // Inline edits (work_type + walk only)
  const [editsMap, setEditsMap] = useState<Record<string, JobEdits>>({})

  // Email body open state
  const [openEmailBodies, setOpenEmailBodies] = useState<Set<string>>(new Set())

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkReject, setShowBulkReject] = useState(false)
  const [bulkRejectReason, setBulkRejectReason] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)

  // ── Data loading ──────────────────────────────────────────────────────────────

  const loadJobs = useCallback(async () => {
    setLoading(true)
    setPageError(null)
    const supabase = createClient()

    // "Show all" shows triaged jobs (scheduled + rejected); default shows flagged queue
    const statusFilter = showAll ? ['scheduled', 'rejected'] : ['flagged']

    const { data, error } = await supabase
      .from('jobs')
      .select(`
        *,
        builder:builders(name),
        subdivision:subdivisions!jobs_subdivision_id_fkey(name, division),
        subcontractor:subcontractors!subcontractor_id(name),
        po:purchase_orders(po_number, amount, clean_type)
      `)
      .in('status', statusFilter)
      .order('created_at', { ascending: false })

    if (error) {
      setPageError(error.message)
      setLoading(false)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = (data ?? []).map((j: any) => ({
      ...j,
      builder_name:       j.builder?.name        ?? null,
      subdivision_name:   j.subdivision?.name     ?? null,
      division:           j.subdivision?.division ?? null,
      subcontractor_name: j.subcontractor?.name   ?? null,
      po_number:          j.po?.po_number         ?? null,
      po_amount:          j.po?.amount            ?? null,
      po_clean_type:      j.po?.clean_type        ?? null,
      po_match_score:     j.po_match_score        ?? null,
    })) as FlaggedJob[]

    setJobs(mapped)
    setLoading(false)
  }, [showAll])

  useEffect(() => { loadJobs() }, [loadJobs])

  // ── History loading ───────────────────────────────────────────────────────────

  async function loadHistory(jobId: string, address: string, builderId: string) {
    if (historyMap[jobId] !== undefined || historyLoading.has(jobId)) return
    setHistoryLoading(prev => new Set([...prev, jobId]))

    const supabase = createClient()
    const { data } = await supabase
      .from('jobs')
      .select('work_type, walk, scheduled_date, status, subcontractor:subcontractors!subcontractor_id(name)')
      .eq('address', address)
      .eq('builder_id', builderId)
      .neq('id', jobId)
      .order('scheduled_date', { ascending: false })
      .limit(20)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const history: JobHistory[] = (data ?? []).map((j: any) => ({
      work_type:          j.work_type,
      walk:               j.walk ?? null,
      scheduled_date:     j.scheduled_date,
      status:             j.status,
      subcontractor_name: j.subcontractor?.name ?? null,
    }))

    setHistoryMap(prev => ({ ...prev, [jobId]: history }))
    setHistoryLoading(prev => { const s = new Set(prev); s.delete(jobId); return s })
  }

  // ── PO matching ───────────────────────────────────────────────────────────────

  async function runPoMatch(jobId: string, address: string, force = false) {
    if (poLoadingSet.has(jobId)) return
    if (poRunDone.has(jobId) && !force) return

    setPoLoadingSet(prev => new Set([...prev, jobId]))
    // Clear stale results on forced re-run
    if (force) {
      setPoResultsMap(prev => { const m = { ...prev }; delete m[jobId]; return m })
    }

    const supabase = createClient()
    const houseNum = address.match(/^\d+/)?.[0]

    let query = supabase
      .from('purchase_orders')
      .select('id, po_number, address, amount, clean_type')
      .limit(50)

    if (houseNum) {
      query = query.ilike('address', `${houseNum}%`)
    }

    const { data } = await query

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: PoResult[] = (data ?? [])
      .map((p: any) => ({
        id:         p.id,
        po_number:  p.po_number,
        address:    p.address   ?? null,
        amount:     p.amount    ?? null,
        clean_type: p.clean_type ?? null,
        score:      p.address ? addressSimilarity(address, p.address) : 0,
      }))
      .filter((p: PoResult) => p.score > 0)
      .sort((a: PoResult, b: PoResult) => b.score - a.score)
      .slice(0, 5)

    setPoResultsMap(prev => ({ ...prev, [jobId]: results }))
    setPoRunDone(prev => new Set([...prev, jobId]))
    setPoLoadingSet(prev => { const s = new Set(prev); s.delete(jobId); return s })
  }

  // ── Card expand ───────────────────────────────────────────────────────────────

  function handleExpand(job: FlaggedJob) {
    if (expandedId === job.id) {
      setExpandedId(null)
      setRejectingId(null)
      return
    }
    setExpandedId(job.id)
    setRejectingId(null)
    setRejectionReason('')

    // Init edits on first open (preserves edits across collapse/expand)
    setEditsMap(prev => {
      if (prev[job.id]) return prev
      return { ...prev, [job.id]: { address: job.address, work_type: job.work_type, walk: job.walk ?? '' } }
    })

    loadHistory(job.id, job.address, job.builder_id)

    // Auto-run PO match silently when address-issue flag present
    if (hasNoPoMatchFlag(job.flag_reason)) {
      runPoMatch(job.id, job.address)
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────────

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSelectedIds(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  async function approveJob(id: string) {
    setActionLoading(prev => new Set([...prev, id]))
    const supabase = createClient()
    const edits     = editsMap[id]
    const selectedPo = selectedPoMap[id]

    const updates: Record<string, unknown> = { status: 'scheduled', flag_reason: null }
    if (edits) {
      updates.address   = edits.address
      updates.work_type = edits.work_type
      updates.walk      = edits.walk || null
    }
    if (selectedPo) {
      updates.po_id = selectedPo
    }

    const { error } = await supabase.from('jobs').update(updates).eq('id', id)
    if (error) {
      setPageError(error.message)
    } else {
      setJobs(prev => prev.filter(j => j.id !== id))
      setExpandedId(null)
      setSelectedIds(prev => { const s = new Set(prev); s.delete(id); return s })
    }
    setActionLoading(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  async function saveEdits(id: string) {
    const edits = editsMap[id]
    if (!edits) return
    setActionLoading(prev => new Set([...prev, id]))
    const supabase = createClient()

    const { error } = await supabase
      .from('jobs')
      .update({ address: edits.address, work_type: edits.work_type, walk: edits.walk || null })
      .eq('id', id)

    if (error) {
      setPageError(error.message)
    } else {
      setJobs(prev => prev.map(j =>
        j.id === id ? { ...j, address: edits.address, work_type: edits.work_type, walk: edits.walk || null } : j
      ))
    }
    setActionLoading(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  async function rejectJob(id: string) {
    setActionLoading(prev => new Set([...prev, id]))
    const supabase = createClient()
    const { error } = await supabase
      .from('jobs')
      .update({ status: 'rejected', instructions: rejectionReason || null })
      .eq('id', id)

    if (error) {
      setPageError(error.message)
    } else {
      setJobs(prev => prev.filter(j => j.id !== id))
      setExpandedId(null)
      setRejectingId(null)
      setRejectionReason('')
      setSelectedIds(prev => { const s = new Set(prev); s.delete(id); return s })
    }
    setActionLoading(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  async function bulkApprove() {
    const ids = Array.from(selectedIds)
    setBulkLoading(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('jobs')
      .update({ status: 'scheduled', flag_reason: null })
      .in('id', ids)

    if (error) {
      setPageError(error.message)
    } else {
      setJobs(prev => prev.filter(j => !ids.includes(j.id)))
      setSelectedIds(new Set())
      setExpandedId(null)
    }
    setBulkLoading(false)
  }

  async function bulkReject() {
    const ids = Array.from(selectedIds)
    setBulkLoading(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('jobs')
      .update({ status: 'rejected', instructions: bulkRejectReason || null })
      .in('id', ids)

    if (error) {
      setPageError(error.message)
    } else {
      setJobs(prev => prev.filter(j => !ids.includes(j.id)))
      setSelectedIds(new Set())
      setExpandedId(null)
      setShowBulkReject(false)
      setBulkRejectReason('')
    }
    setBulkLoading(false)
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  // ── Edit helpers ──────────────────────────────────────────────────────────────

  function updateEdit(id: string, field: keyof JobEdits, value: string) {
    setEditsMap(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  function isDirty(job: FlaggedJob): boolean {
    const e = editsMap[job.id]
    if (!e) return false
    return e.address !== job.address || e.work_type !== job.work_type || (e.walk || null) !== job.walk
  }

  function isFieldEdited(job: FlaggedJob, field: keyof JobEdits): boolean {
    const e = editsMap[job.id]
    if (!e) return false
    if (field === 'address')   return e.address !== job.address
    if (field === 'work_type') return e.work_type !== job.work_type
    if (field === 'walk')      return (e.walk || null) !== job.walk
    return false
  }

  // ── Sort helpers ──────────────────────────────────────────────────────────────

  function addSortTier() {
    if (sortTiers.some(t => t.field === pendingSortField)) return
    setSortTiers(prev => [...prev, { field: pendingSortField, dir: pendingSortDir }])
    setShowSortPopover(false)
  }

  function removeSortTier(field: SortField) {
    setSortTiers(prev => prev.filter(t => t.field !== field))
  }

  function sortChipLabel(tier: SortTier): string {
    const short: Record<SortField, string> = {
      date_received: 'Date', scheduled_date: 'Sched',
      builder: 'Builder', work_type: 'Type', flag_reason_category: 'Flag',
    }
    return `${short[tier.field]} ${tier.dir === 'asc' ? '↑' : '↓'}`
  }

  // ── Filtering & sorting ───────────────────────────────────────────────────────

  const filteredJobs = jobs.filter(j => {
    if (builderFilter !== 'all' && j.builder_name !== builderFilter) return false
    if (dateFilter === 'today'    && !flaggedToday(j.created_at))       return false
    if (dateFilter === 'upcoming' && !scheduledFuture(j.scheduled_date)) return false
    if (workTypeFilter !== 'all'  && j.work_type !== workTypeFilter)     return false
    if (walkFilter !== 'all'      && j.walk !== walkFilter)              return false
    if (flagReasonFilter !== 'all') {
      const reasons = getFlagReasons(j.flag_reason)
      if (!reasons.some(r => categorizeFlagReason(r) === flagReasonFilter)) return false
    }
    return true
  })

  const sortedJobs = sortTiers.length === 0 ? filteredJobs : [...filteredJobs].sort((a, b) => {
    for (const tier of sortTiers) {
      let av = '', bv = ''
      switch (tier.field) {
        case 'date_received':        av = a.created_at;                       bv = b.created_at;                       break
        case 'scheduled_date':       av = a.scheduled_date;                   bv = b.scheduled_date;                   break
        case 'builder':              av = a.builder_name ?? '';               bv = b.builder_name ?? '';               break
        case 'work_type':            av = a.work_type;                        bv = b.work_type;                        break
        case 'flag_reason_category': av = getPrimaryCategory(a.flag_reason);  bv = getPrimaryCategory(b.flag_reason);  break
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      if (cmp !== 0) return tier.dir === 'asc' ? cmp : -cmp
    }
    return 0
  })

  const flaggedCount = jobs.filter(j => j.status === 'flagged').length

  // ── Card render ───────────────────────────────────────────────────────────────

  function renderCard(job: FlaggedJob) {
    const isFlagged     = job.status === 'flagged'
    const isExpanded    = expandedId === job.id
    const isSelected    = selectedIds.has(job.id)
    const builderColor  = BUILDER_COLORS[job.builder_name ?? ''] ?? '#9CA3AF'
    const badge         = WORK_TYPE_BADGES[job.work_type]
    const flagReasons   = getFlagReasons(job.flag_reason)
    const firstReason   = flagReasons[0] ?? null
    const extraCount    = flagReasons.length - 1
    const isActing      = actionLoading.has(job.id)
    const isRejecting   = rejectingId === job.id
    const history       = historyMap[job.id]
    const histIsLoading = historyLoading.has(job.id)
    const edits         = editsMap[job.id]
    const dirty         = isFlagged && isDirty(job)
    const walks         = BUILDER_WALKS[job.builder_name ?? ''] ?? ALL_WALKS
    const poResults     = poResultsMap[job.id] ?? []
    const poIsLoading   = poLoadingSet.has(job.id)
    const poDidRun      = poRunDone.has(job.id)
    const selectedPo    = selectedPoMap[job.id] ?? null
    const isNoPoFlag    = hasNoPoMatchFlag(job.flag_reason)
    // Show PO search UI when flag has no-PO reason OR when there is no linked PO
    const showPoSearch  = isNoPoFlag || !job.po_id

    return (
      <div
        key={job.id}
        style={{
          background: '#fff',
          borderRadius: 10,
          border: isSelected ? '1.5px solid #2563EB' : '1px solid #E5E7EB',
          marginBottom: 10,
          overflow: 'hidden',
          boxShadow: isExpanded ? '0 2px 12px rgba(0,0,0,0.08)' : '0 1px 3px rgba(0,0,0,0.04)',
          opacity: isFlagged ? 1 : 0.75,
          transition: 'box-shadow 0.15s, opacity 0.15s',
        }}
      >

        {/* ── Collapsed header ── */}
        <div
          onClick={() => handleExpand(job)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 16px', cursor: 'pointer',
            borderLeft: `4px solid ${isFlagged ? builderColor : '#D1D5DB'}`,
            background: isExpanded ? '#FAFAFA' : '#fff',
            userSelect: 'none',
          }}
        >
          {isFlagged && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => {}}
              onClick={e => toggleSelect(job.id, e)}
              style={{ flexShrink: 0, cursor: 'pointer', accentColor: '#2563EB', width: 15, height: 15 }}
            />
          )}

          {isFlagged
            ? <span style={{ fontSize: 15, flexShrink: 0 }}>⚠️</span>
            : <span style={{ fontSize: 13, color: '#9CA3AF', flexShrink: 0 }}>✓</span>
          }

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: '#1F2937', fontSize: 14 }}>{job.address}</span>
              {badge && (
                <span style={{
                  background: badge.bg, color: badge.text,
                  borderRadius: 5, padding: '1px 7px', fontSize: 11, fontWeight: 700, flexShrink: 0,
                }}>
                  {job.work_type}
                </span>
              )}
              {!isFlagged && (
                <span style={{
                  fontSize: 11,
                  color:      (STATUS_COLORS[job.status] ?? STATUS_COLORS.scheduled).text,
                  background: (STATUS_COLORS[job.status] ?? STATUS_COLORS.scheduled).bg,
                  borderRadius: 5, padding: '1px 7px',
                }}>
                  {job.status}
                </span>
              )}
            </div>
            <div style={{
              display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap',
              color: '#6B7280', fontSize: 12, alignItems: 'center',
            }}>
              <span style={{ fontWeight: 600, color: isFlagged ? builderColor : '#9CA3AF' }}>
                {job.builder_name ?? '—'}
              </span>
              {job.walk && <><span style={{ color: '#D1D5DB' }}>•</span><span>{job.walk}</span></>}
              <span style={{ color: '#D1D5DB' }}>•</span>
              <span>{formatDate(job.scheduled_date)}</span>
              {isFlagged && firstReason && (
                <>
                  <span style={{ color: '#D1D5DB' }}>•</span>
                  <span style={{ color: '#92400E', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {firstReason}
                  </span>
                  {extraCount > 0 && <span style={{ color: '#9CA3AF', flexShrink: 0 }}>+{extraCount} more</span>}
                </>
              )}
            </div>
          </div>

          <span style={{ fontSize: 11, color: '#9CA3AF', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {timeAgo(job.created_at)}
          </span>
          <span style={{ color: '#D1D5DB', fontSize: 10, flexShrink: 0 }}>
            {isExpanded ? '▲' : '▼'}
          </span>
        </div>

        {/* ── Expanded detail ── */}
        {isExpanded && (
          <div style={{ borderLeft: `4px solid ${isFlagged ? builderColor : '#D1D5DB'}`, padding: '0 20px 20px' }}>

            {/* Section 1 — Extracted Data */}
            <div style={{ paddingTop: 16, paddingBottom: 16, borderBottom: '1px solid #F3F4F6' }}>
              <SectionHeader>Extracted Data</SectionHeader>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px 24px' }}>

                {/* Address — editable for flagged jobs */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                    <label style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>Address</label>
                    {isFlagged && edits && isFieldEdited(job, 'address') && <EditedBadge />}
                  </div>
                  {isFlagged && edits ? (
                    <input
                      value={edits.address}
                      onChange={e => updateEdit(job.id, 'address', e.target.value)}
                      style={{
                        width: '100%', padding: '7px 10px', borderRadius: 6,
                        border: '1px solid #D1D5DB', fontSize: 13,
                        outline: 'none', color: '#1F2937', background: '#fff',
                        boxSizing: 'border-box',
                      }}
                    />
                  ) : (
                    <div style={{ fontSize: 13, color: '#1F2937' }}>{job.address}</div>
                  )}
                </div>

                {isFlagged && edits ? (
                  <>
                    {/* Work Type — editable dropdown */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                        <label style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>Work Type</label>
                        {isFieldEdited(job, 'work_type') && <EditedBadge />}
                      </div>
                      <select
                        value={edits.work_type}
                        onChange={e => updateEdit(job.id, 'work_type', e.target.value)}
                        style={{
                          width: '100%', padding: '7px 10px', borderRadius: 6,
                          border: '1px solid #D1D5DB', fontSize: 13,
                          outline: 'none', color: '#1F2937', background: '#fff',
                        }}
                      >
                        {WORK_TYPES.map(wt => <option key={wt} value={wt}>{wt}</option>)}
                      </select>
                    </div>

                    {/* Walk — editable builder-aware dropdown */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                        <label style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>Walk</label>
                        {isFieldEdited(job, 'walk') && <EditedBadge />}
                      </div>
                      <select
                        value={edits.walk}
                        onChange={e => updateEdit(job.id, 'walk', e.target.value)}
                        style={{
                          width: '100%', padding: '7px 10px', borderRadius: 6,
                          border: '1px solid #D1D5DB', fontSize: 13,
                          outline: 'none', color: '#1F2937', background: '#fff',
                        }}
                      >
                        <option value="">— (none)</option>
                        {walks.map(w => <option key={w} value={w}>{w}</option>)}
                      </select>
                    </div>
                  </>
                ) : (
                  <>
                    <Field label="Work Type" value={job.work_type} />
                    <Field label="Walk"      value={job.walk} />
                  </>
                )}

                {/* Read-only fields */}
                <Field label="Scheduled Date" value={formatDate(job.scheduled_date)} />
                {job.scheduled_time  && <Field label="Time"         value={job.scheduled_time} />}
                {job.requester       && <Field label="Requester"    value={job.requester} />}
                <Field label="Builder"          value={job.builder_name} />
                {job.subdivision_name && <Field label="Subdivision" value={job.subdivision_name} />}

                {job.instructions && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600, marginBottom: 4 }}>Instructions</div>
                    <div style={{
                      fontSize: 13, color: '#1F2937', background: '#F9FAFB',
                      border: '1px solid #E5E7EB', borderRadius: 6, padding: '8px 10px', whiteSpace: 'pre-wrap',
                    }}>
                      {job.instructions}
                    </div>
                  </div>
                )}

                {job.source_email_id && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600, marginBottom: 4 }}>Source Email ID</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <code style={{
                        fontSize: 12, color: '#374151', background: '#F3F4F6',
                        padding: '3px 8px', borderRadius: 5, wordBreak: 'break-all',
                      }}>
                        {job.source_email_id}
                      </code>
                      <button
                        onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(job.source_email_id!) }}
                        style={{
                          fontSize: 11, color: '#6B7280', background: '#F9FAFB',
                          border: '1px solid #E5E7EB', borderRadius: 5, padding: '2px 8px', cursor: 'pointer',
                        }}
                      >
                        Copy
                      </button>
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                      Search this ID in Outlook to find the original email
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Section 2 — Flag Reasons (flagged only) */}
            {isFlagged && flagReasons.length > 0 && (
              <div style={{ paddingTop: 16, paddingBottom: 16, borderBottom: '1px solid #F3F4F6' }}>
                <SectionHeader>Flag Reasons</SectionHeader>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {flagReasons.map((reason, i) => (
                    <span key={i} style={{
                      display: 'inline-flex', alignSelf: 'flex-start',
                      background: '#FEF3C7', color: '#92400E',
                      border: '1px solid #FDE68A', borderRadius: 6,
                      padding: '5px 12px', fontSize: 12, fontWeight: 500,
                    }}>
                      {reason}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Section 3 — PO Match */}
            <div style={{ paddingTop: 16, paddingBottom: 16, borderBottom: '1px solid #F3F4F6' }}>
              <SectionHeader>PO Match</SectionHeader>

              {!showPoSearch ? (
                /* PO already linked at extraction time */
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px 24px', marginBottom: 12 }}>
                    {job.po_number     && <Field label="PO Number"  value={job.po_number} />}
                    {job.po_amount  != null && <Field label="Amount" value={`$${job.po_amount.toLocaleString()}`} />}
                    {job.po_clean_type && <Field label="Clean Type" value={job.po_clean_type} />}
                    {job.po_match_score != null && (
                      <div>
                        <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600, marginBottom: 2 }}>Match Score</div>
                        <span style={{ fontSize: 16, fontWeight: 800, color: scoreColor(job.po_match_score) }}>
                          {(job.po_match_score * 100).toFixed(0)}%
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); runPoMatch(job.id, job.address, true) }}
                    style={{
                      fontSize: 12, color: '#6B7280', background: '#F9FAFB',
                      border: '1px solid #E5E7EB', borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
                    }}
                  >
                    Re-run PO match
                  </button>
                  {/* Show re-run results below existing PO */}
                  {poDidRun && poResults.length > 0 && renderPoResults(job.id, poResults, selectedPo, poIsLoading, true)}
                </div>
              ) : (
                /* No linked PO — show search UI */
                <div>
                  {/* Banner when auto-run found results since flagging */}
                  {isNoPoFlag && poDidRun && poResults.length > 0 && (
                    <div style={{
                      background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6,
                      padding: '7px 12px', fontSize: 12, color: '#92400E', marginBottom: 12,
                    }}>
                      PO match found since flagging — review and confirm.
                    </div>
                  )}

                  {poIsLoading ? (
                    <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 12 }}>Running PO match…</div>
                  ) : poResults.length > 0 ? (
                    renderPoResults(job.id, poResults, selectedPo, poIsLoading, false)
                  ) : (
                    <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 12 }}>No PO match found</div>
                  )}

                  <button
                    onClick={e => { e.stopPropagation(); runPoMatch(job.id, job.address, true) }}
                    disabled={poIsLoading}
                    style={{
                      fontSize: 12, color: '#6B7280', background: '#F9FAFB',
                      border: '1px solid #E5E7EB', borderRadius: 6, padding: '5px 12px',
                      cursor: poIsLoading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {poIsLoading ? 'Running…' : 'Re-run PO match'}
                  </button>
                </div>
              )}
            </div>

            {/* Section 4 — Other Jobs at This Address */}
            <div style={{ paddingTop: 16, paddingBottom: 16, borderBottom: '1px solid #F3F4F6' }}>
              <SectionHeader>Other Jobs at This Address</SectionHeader>
              {histIsLoading ? (
                <div style={{ fontSize: 13, color: '#9CA3AF' }}>Loading…</div>
              ) : !history || history.length === 0 ? (
                <div style={{ fontSize: 13, color: '#9CA3AF' }}>No other jobs at this address</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                        {['Type', 'Walk', 'Date', 'Status', 'Subcontractor'].map(h => (
                          <th key={h} style={{
                            textAlign: 'left', padding: '4px 8px 8px',
                            color: '#9CA3AF', fontWeight: 600, whiteSpace: 'nowrap', fontSize: 11,
                          }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h, i) => {
                        const hb = WORK_TYPE_BADGES[h.work_type]
                        const sc = STATUS_COLORS[h.status] ?? { bg: '#F3F4F6', text: '#6B7280' }
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid #F9FAFB' }}>
                            <td style={{ padding: '5px 8px' }}>
                              {hb ? (
                                <span style={{ background: hb.bg, color: hb.text, borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>
                                  {h.work_type}
                                </span>
                              ) : (
                                <span style={{ color: '#374151' }}>{h.work_type}</span>
                              )}
                            </td>
                            <td style={{ padding: '5px 8px', color: '#374151' }}>{h.walk ?? '—'}</td>
                            <td style={{ padding: '5px 8px', color: '#374151', whiteSpace: 'nowrap' }}>
                              {formatDate(h.scheduled_date)}
                            </td>
                            <td style={{ padding: '5px 8px' }}>
                              <span style={{
                                background: sc.bg, color: sc.text, borderRadius: 4,
                                padding: '1px 7px', fontSize: 11, fontWeight: 600, textTransform: 'capitalize',
                              }}>
                                {h.status}
                              </span>
                            </td>
                            <td style={{ padding: '5px 8px', color: '#374151' }}>{h.subcontractor_name ?? '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Section 5 — Source Email Body */}
            {job.source_email_body && (
              <div style={{ paddingTop: 16, paddingBottom: 16, borderBottom: '1px solid #F3F4F6' }}>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    setOpenEmailBodies(prev => {
                      const s = new Set(prev)
                      s.has(job.id) ? s.delete(job.id) : s.add(job.id)
                      return s
                    })
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    fontSize: 10, fontWeight: 700, color: '#9CA3AF',
                    textTransform: 'uppercase', letterSpacing: 0.8,
                  }}
                >
                  <span>Source Email Body</span>
                  <span style={{ fontSize: 9 }}>{openEmailBodies.has(job.id) ? '▲' : '▼'}</span>
                </button>
                {openEmailBodies.has(job.id) && (
                  <div style={{
                    marginTop: 10, fontSize: 12, color: '#374151',
                    background: '#F9FAFB', border: '1px solid #E5E7EB',
                    borderRadius: 6, padding: '10px 12px',
                    whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto',
                    fontFamily: 'monospace', lineHeight: 1.6,
                  }}>
                    {job.source_email_body}
                  </div>
                )}
              </div>
            )}

            {/* ── Action Buttons (flagged only) ── */}
            {isFlagged && (
              <div style={{ paddingTop: 16 }}>
                {isRejecting ? (
                  <div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>
                        Rejection reason (optional)
                      </label>
                      <textarea
                        value={rejectionReason}
                        onChange={e => setRejectionReason(e.target.value)}
                        placeholder="e.g. Duplicate job, wrong address, not a valid request…"
                        rows={2}
                        style={{
                          width: '100%', padding: '8px 10px', borderRadius: 7,
                          border: '1px solid #D1D5DB', fontSize: 13, resize: 'vertical',
                          outline: 'none', color: '#1F2937', fontFamily: 'inherit',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => rejectJob(job.id)}
                        disabled={isActing}
                        style={{
                          background: isActing ? '#FCA5A5' : '#DC2626', color: '#fff',
                          border: 'none', borderRadius: 7, padding: '9px 20px',
                          fontSize: 13, fontWeight: 700, cursor: isActing ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {isActing ? 'Rejecting…' : 'Confirm Reject'}
                      </button>
                      <button
                        onClick={() => { setRejectingId(null); setRejectionReason('') }}
                        style={{
                          background: '#F3F4F6', color: '#374151', border: 'none',
                          borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      onClick={() => approveJob(job.id)}
                      disabled={isActing}
                      style={{
                        background: isActing ? '#86EFAC' : '#16A34A', color: '#fff',
                        border: 'none', borderRadius: 7, padding: '9px 22px',
                        fontSize: 13, fontWeight: 700, cursor: isActing ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {isActing ? 'Approving…' : dirty ? '✓ Save & Approve' : '✓ Approve'}
                    </button>
                    <button
                      onClick={() => setRejectingId(job.id)}
                      disabled={isActing}
                      style={{
                        background: '#fff', color: '#DC2626',
                        border: '1.5px solid #DC2626', borderRadius: 7, padding: '9px 22px',
                        fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      ✕ Reject
                    </button>
                    {dirty && (
                      <button
                        onClick={() => saveEdits(job.id)}
                        disabled={isActing}
                        style={{
                          background: '#EFF6FF', color: '#2563EB',
                          border: '1.5px solid #BFDBFE', borderRadius: 7, padding: '9px 22px',
                          fontSize: 13, fontWeight: 700, cursor: isActing ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {isActing ? 'Saving…' : 'Save Edits'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── PO results table (shared between linked + search cases) ───────────────────

  function renderPoResults(
    jobId: string,
    results: PoResult[],
    selectedPo: string | null,
    isLoading: boolean,
    isSecondary: boolean,
  ) {
    return (
      <div style={{ marginBottom: isSecondary ? 0 : 12, marginTop: isSecondary ? 12 : 0 }}>
        {isSecondary && (
          <div style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Re-run Results
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                {['', 'PO Number', 'Address', 'Amount', 'Score'].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '4px 8px 8px',
                    color: '#9CA3AF', fontWeight: 600, whiteSpace: 'nowrap', fontSize: 11,
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map(po => (
                <tr
                  key={po.id}
                  onClick={e => {
                    if (isLoading) return
                    e.stopPropagation()
                    setSelectedPoMap(prev => ({
                      ...prev,
                      [jobId]: prev[jobId] === po.id ? null : po.id,
                    }))
                  }}
                  style={{
                    borderBottom: '1px solid #F9FAFB',
                    background: selectedPo === po.id ? '#EFF6FF' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <td style={{ padding: '5px 8px' }}>
                    <input
                      type="radio"
                      readOnly
                      checked={selectedPo === po.id}
                      style={{ accentColor: '#2563EB' }}
                    />
                  </td>
                  <td style={{ padding: '5px 8px', color: '#374151', fontWeight: 600 }}>{po.po_number}</td>
                  <td style={{ padding: '5px 8px', color: '#374151' }}>{po.address ?? '—'}</td>
                  <td style={{ padding: '5px 8px', color: '#374151', whiteSpace: 'nowrap' }}>
                    {po.amount != null ? `$${po.amount.toLocaleString()}` : '—'}
                  </td>
                  <td style={{ padding: '5px 8px' }}>
                    <span style={{ fontWeight: 700, color: scoreColor(po.score) }}>
                      {(po.score * 100).toFixed(0)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selectedPo && (
          <button
            onClick={e => { e.stopPropagation(); setSelectedPoMap(prev => ({ ...prev, [jobId]: null })) }}
            style={{
              marginTop: 6, fontSize: 11, color: '#9CA3AF', background: 'none',
              border: 'none', cursor: 'pointer', padding: 0,
            }}
          >
            Clear selection
          </button>
        )}
      </div>
    )
  }

  // ── Page render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB' }}>

      {/* Sticky header */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #E5E7EB',
        padding: '14px 24px', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>

          {/* Title row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: '#1F2937', letterSpacing: -0.3 }}>
                Flag Review
              </span>
              <span style={{
                background: flaggedCount > 0 ? '#FEF3C7' : '#F3F4F6',
                color:      flaggedCount > 0 ? '#92400E' : '#9CA3AF',
                borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700,
              }}>
                {loading ? '…' : `${flaggedCount} flagged`}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button
                onClick={() => { setShowAll(!showAll); setSelectedIds(new Set()); setExpandedId(null) }}
                style={{
                  fontSize: 12, fontWeight: showAll ? 700 : 400,
                  color: showAll ? '#2563EB' : '#9CA3AF',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                }}
              >
                {showAll ? 'Hide past jobs' : 'Show all jobs'}
              </button>
              <button
                onClick={handleSignOut}
                style={{ fontSize: 12, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                Sign out
              </button>
            </div>
          </div>

          {/* Filter rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>

            {/* Row 1 — Builder + Date */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
              <FilterGroupLabel>Builder</FilterGroupLabel>
              {['all', 'DR Horton', 'Stylecraft', 'Castlerock', 'Omega'].map(b => (
                <FilterChip key={b} active={builderFilter === b} onClick={() => setBuilderFilter(b)}>
                  {b === 'all' ? 'All' : b}
                </FilterChip>
              ))}
              <FilterDivider />
              <FilterGroupLabel>Date</FilterGroupLabel>
              {([
                { val: 'all', label: 'All' },
                { val: 'today', label: 'Today' },
                { val: 'upcoming', label: 'Upcoming' },
              ] as const).map(({ val, label }) => (
                <FilterChip key={val} active={dateFilter === val} onClick={() => setDateFilter(val)}>
                  {label}
                </FilterChip>
              ))}
            </div>

            {/* Row 2 — Work Type */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
              <FilterGroupLabel>Type</FilterGroupLabel>
              <FilterChip active={workTypeFilter === 'all'} onClick={() => setWorkTypeFilter('all')}>All</FilterChip>
              {WORK_TYPE_FILTER_OPTIONS.map(wt => (
                <FilterChip key={wt} active={workTypeFilter === wt} onClick={() => setWorkTypeFilter(wt)}>
                  {wt}
                </FilterChip>
              ))}
            </div>

            {/* Row 3 — Walk */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
              <FilterGroupLabel>Walk</FilterGroupLabel>
              <FilterChip active={walkFilter === 'all'} onClick={() => setWalkFilter('all')}>All</FilterChip>
              {ALL_WALKS.map(w => (
                <FilterChip key={w} active={walkFilter === w} onClick={() => setWalkFilter(w)}>{w}</FilterChip>
              ))}
            </div>

            {/* Row 4 — Flag Reason */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
              <FilterGroupLabel>Flag</FilterGroupLabel>
              <FilterChip active={flagReasonFilter === 'all'} onClick={() => setFlagReasonFilter('all')}>All</FilterChip>
              {FLAG_REASON_CATEGORIES.map(({ val, label }) => (
                <FilterChip key={val} active={flagReasonFilter === val} onClick={() => setFlagReasonFilter(val)}>
                  {label}
                </FilterChip>
              ))}
            </div>

            {/* Row 5 — Sort */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
              <button
                onClick={() => setShowSortPopover(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  border: '1px solid #E5E7EB',
                  background: sortTiers.length > 0 ? '#1F2937' : '#fff',
                  color:      sortTiers.length > 0 ? '#fff'    : '#6B7280',
                  cursor: 'pointer',
                }}
              >
                ⇅ Sort
              </button>

              {/* Active tier chips */}
              {sortTiers.map(tier => (
                <span key={tier.field} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  background: '#F3F4F6', color: '#374151', border: '1px solid #E5E7EB',
                }}>
                  {sortChipLabel(tier)}
                  <button
                    onClick={() => removeSortTier(tier.field)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#9CA3AF', fontSize: 12, lineHeight: 1 }}
                  >
                    ×
                  </button>
                </span>
              ))}

              {/* Sort popover */}
              {showSortPopover && (
                <>
                  <div
                    onClick={() => setShowSortPopover(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: 20 }}
                  />
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, marginTop: 6,
                    background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.12)', zIndex: 30,
                    padding: 16, minWidth: 340,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>
                      Add Sort Tier
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
                      <select
                        value={pendingSortField}
                        onChange={e => setPendingSortField(e.target.value as SortField)}
                        style={{
                          flex: 1, padding: '7px 10px', borderRadius: 6,
                          border: '1px solid #D1D5DB', fontSize: 13,
                          color: '#1F2937', background: '#fff', outline: 'none',
                        }}
                      >
                        {(Object.keys(SORT_FIELD_LABELS) as SortField[]).map(f => (
                          <option key={f} value={f}>{SORT_FIELD_LABELS[f]}</option>
                        ))}
                      </select>
                      <select
                        value={pendingSortDir}
                        onChange={e => setPendingSortDir(e.target.value as SortDir)}
                        style={{
                          padding: '7px 10px', borderRadius: 6,
                          border: '1px solid #D1D5DB', fontSize: 13,
                          color: '#1F2937', background: '#fff', outline: 'none',
                        }}
                      >
                        <option value="asc">A → Z / Oldest</option>
                        <option value="desc">Z → A / Newest</option>
                      </select>
                      <button
                        onClick={addSortTier}
                        style={{
                          padding: '7px 14px', borderRadius: 6,
                          background: '#1F2937', color: '#fff',
                          border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        Add
                      </button>
                    </div>

                    {sortTiers.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
                          Active Tiers
                        </div>
                        {sortTiers.map((tier, i) => (
                          <div key={tier.field} style={{
                            display: 'flex', alignItems: 'center',
                            padding: '6px 10px', borderRadius: 6, background: '#F9FAFB',
                            marginBottom: 4, fontSize: 12,
                          }}>
                            <span style={{ color: '#9CA3AF', marginRight: 8, minWidth: 14 }}>{i + 1}.</span>
                            <span style={{ flex: 1, color: '#374151', fontWeight: 500 }}>
                              {SORT_FIELD_LABELS[tier.field]} — {tier.dir === 'asc' ? 'A → Z / Oldest' : 'Z → A / Newest'}
                            </span>
                            <button
                              onClick={() => removeSortTier(tier.field)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 16, lineHeight: 1, padding: 0 }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => setSortTiers([])}
                          style={{ marginTop: 8, fontSize: 11, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                          Clear all
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px', paddingBottom: selectedIds.size > 0 ? 100 : 20 }}>

        {pageError && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8,
            padding: '12px 16px', fontSize: 13, color: '#EF4444', marginBottom: 16,
          }}>
            Error: {pageError}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#9CA3AF', fontSize: 14 }}>
            Loading{showAll ? ' past jobs' : ' flagged jobs'}…
          </div>
        ) : sortedJobs.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '60px 24px',
            background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB',
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1F2937', marginBottom: 6 }}>
              {flaggedCount === 0 && !showAll ? 'No flagged jobs' : 'No jobs match the current filters'}
            </div>
            <div style={{ fontSize: 13, color: '#9CA3AF' }}>
              {flaggedCount === 0 && !showAll
                ? 'All clear — no jobs are waiting for review.'
                : 'Try adjusting the filters.'}
            </div>
          </div>
        ) : (
          sortedJobs.map(job => renderCard(job))
        )}
      </div>

      {/* ── Floating bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#1F2937', borderRadius: 14,
          boxShadow: '0 8px 32px rgba(0,0,0,0.28)', zIndex: 50,
          minWidth: 360, maxWidth: '90vw', overflow: 'hidden',
        }}>
          {showBulkReject && (
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #374151' }}>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 6 }}>
                Rejection reason for {selectedIds.size} job{selectedIds.size > 1 ? 's' : ''} (optional)
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={bulkRejectReason}
                  onChange={e => setBulkRejectReason(e.target.value)}
                  placeholder="e.g. Duplicate jobs, wrong builder…"
                  autoFocus
                  style={{
                    flex: 1, padding: '7px 10px', borderRadius: 7,
                    border: '1px solid #374151', background: '#111827',
                    fontSize: 13, color: '#fff', outline: 'none',
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') bulkReject() }}
                />
                <button
                  onClick={bulkReject}
                  disabled={bulkLoading}
                  style={{
                    background: '#DC2626', color: '#fff', border: 'none',
                    borderRadius: 7, padding: '7px 14px', fontSize: 13, fontWeight: 700,
                    cursor: bulkLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {bulkLoading ? '…' : 'Confirm'}
                </button>
                <button
                  onClick={() => { setShowBulkReject(false); setBulkRejectReason('') }}
                  style={{
                    background: '#374151', color: '#D1D5DB', border: 'none',
                    borderRadius: 7, padding: '7px 12px', fontSize: 13, cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', padding: '14px 16px', flexShrink: 0 }}>
              {selectedIds.size} selected
            </span>
            <div style={{ width: 1, height: 20, background: '#374151', flexShrink: 0 }} />
            <button
              onClick={bulkApprove}
              disabled={bulkLoading}
              style={{
                flex: 1, padding: '14px 16px', background: 'none', color: '#4ADE80',
                border: 'none', fontSize: 13, fontWeight: 700,
                cursor: bulkLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {bulkLoading ? '…' : `✓ Approve (${selectedIds.size})`}
            </button>
            <div style={{ width: 1, height: 20, background: '#374151', flexShrink: 0 }} />
            <button
              onClick={() => setShowBulkReject(v => !v)}
              disabled={bulkLoading}
              style={{
                flex: 1, padding: '14px 16px', background: 'none', color: '#F87171',
                border: 'none', fontSize: 13, fontWeight: 700,
                cursor: bulkLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {`✕ Reject (${selectedIds.size})`}
            </button>
            <div style={{ width: 1, height: 20, background: '#374151', flexShrink: 0 }} />
            <button
              onClick={() => { setSelectedIds(new Set()); setShowBulkReject(false) }}
              style={{
                padding: '14px 16px', background: 'none', color: '#9CA3AF',
                border: 'none', fontSize: 12, cursor: 'pointer',
              }}
            >
              Deselect All
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
