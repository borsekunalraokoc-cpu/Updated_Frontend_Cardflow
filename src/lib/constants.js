export const DIVISIONS = ['KOC Cards', 'Bombay Cards']

export const STORES = [
  'Chamrajpet',
  'HSR Layout',
  'Sahakar Nagar',
  'Hoodi',
  'Jayanagar',
  'Bommasandra',
  'Hyderabad',
  'Mysore',
  'Vizag',
  'Hubli',
  'Chitradurga',
  'Kundapur',
]

export const STAGES = [
  { k: 'barcoding', n: 'Bar Coding' },
  { k: 'content', n: 'Content' },
  { k: 'photography', n: 'Photography' },
  { k: 'photoedit', n: 'Photo Editing' },
  { k: 'videography', n: 'Videography' },
  { k: 'dimensions', n: 'Dimensions' },
  { k: 'videoedit', n: 'Video Editing' },
  { k: 'images', n: 'Video Uploaded' },
  { k: 'backend', n: 'Backend Listing (App)' },
  { k: 'website', n: 'Website Listing (Shopify)' },
  { k: 'finalqc', n: 'Final QC / Audit' },
]

export const STATUSES = ['Not Started', 'In Progress', 'Completed', 'Issue']

// finalqc is the verdict screen, so it is excluded from the pipeline stage list
export const STAGE_COLS = STAGES.filter((s) => s.k !== 'finalqc')

export const DEFAULT_VENDORS = {
  'KOC Cards': [
    'KOC',
    'Patrika',
    'Mayur',
    'Rasiklal',
    'Venis',
    'Ferry Card',
    'Mack Mark',
    'Shubham',
    'Mani Creation',
    'Jimit',
    'Reel Card',
    'Swamy Cards',
    'Remco',
    'Sanskurti',
    'Aakarshak',
  ],
  'Bombay Cards': [
    'Rasiklal & Bros',
    'Patrika Palace',
    'Real Cards',
    'JIMIT CARDS',
    'Aakarshak Cards',
    'Devarajan & sons',
    'Sanskruti Cards',
    'Rama Cards',
    'Mack Mark',
    'Phoenix Cards',
    'Remco Cards',
    'Venis Cards',
    'Mani Creation',
    'Rickabchand',
    'Shankheshwar Cards',
    'Shubham Cards',
    'Creative Crafts',
    'Ferry Cards',
    'Swamy Cards',
  ],
}

// Stage groups used by Speed Analytics tables
export const BACKEND_STAGE_GROUP = [
  { k: 'content', n: 'Content' },
  { k: 'dimensions', n: 'Dimension' },
  { k: 'images', n: 'Video Upload' },
  { k: 'backend', n: 'Backend Listing (App)' },
  { k: 'website', n: 'Website Listing (Shopify)' },
]

export const PHOTO_VIDEO_STAGE_GROUP = [
  { k: 'photography', n: 'Photography' },
  { k: 'photoedit', n: 'Photo Editing' },
  { k: 'videography', n: 'Videography' },
  { k: 'videoedit', n: 'Video Editing' },
]

// Column headers for Excel import/export
export const STORE_HEADERS = [
  'division',
  'sku',
  'store',
  'dispatched',
  'received',
  'missing',
  'damaged',
  'notes',
]

export const PROD_HEADERS = (() => {
  const h = ['division', 'sku', 'name', 'vendor', 'inward', 'qty', 'note', 'set_no']
  STAGE_COLS.forEach((s) => {
    h.push(s.k + '_status', s.k + '_person', s.k + '_comments')
    if (s.k === 'dimensions') h.push('dimensions_width', 'dimensions_height', 'dimensions_weight')
  })
  h.push('qc_verdict', 'qc_issues')
  return h
})()