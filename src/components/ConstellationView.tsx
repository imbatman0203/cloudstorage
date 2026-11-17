import { useMemo, useState } from 'react'
import { ArrowUpRight, Film, Play, Sparkles } from 'lucide-react'
import { CATEGORIES, Clip, toneColor } from '../types'

type NodePoint = {
  clip: Clip
  x: number
  y: number
  r: number
  color: string
}

function hashSeed(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}

function layoutNodes(clips: Clip[], width: number, height: number): NodePoint[] {
  const padX = 52
  const padY = 42
  const usableW = Math.max(100, width - padX * 2)
  const usableH = Math.max(80, height - padY * 2)

  return clips.map((clip, index) => {
    const seed = hashSeed(clip.id)
    const count = clips.length
    // Spread clips chronologically along X with organic Y curves grouped gently by category
    const baseT = count === 1 ? 0.5 : index / (count - 1)
    const jitterX = ((seed % 100) / 100 - 0.5) * Math.min(34, usableW / Math.max(count, 4))
    const catIndex = Math.max(0, CATEGORIES.indexOf(clip.category as any))
    const catBand = (catIndex + 0.5) / CATEGORIES.length
    const wave = Math.sin(baseT * Math.PI * 2.2 + catIndex * 1.4) * 0.16
    const jitterY = (((seed >> 7) % 100) / 100 - 0.5) * 0.22
    const normY = Math.min(0.88, Math.max(0.14, catBand * 0.72 + 0.14 + wave + jitterY))

    const x = Math.min(width - padX, Math.max(padX, padX + baseT * usableW + jitterX))
    const y = padY + normY * usableH
    const r = Math.min(13, Math.max(6.5, 6.5 + Math.log10(Math.max(1, clip.durationSeconds + 5)) * 2.4))

    return {
      clip,
      x,
      y,
      r,
      color: toneColor(clip.tone, clip.accentColor)
    }
  })
}

function buildCurvePath(points: NodePoint[]): string {
  if (points.length < 2) return ''
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const cx = ((prev.x + curr.x) / 2).toFixed(1)
    d += ` C ${cx} ${prev.y.toFixed(1)}, ${cx} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`
  }
  return d
}

const AMBIENT_STARS = [
  { x: 111, y: 54, r: 2.2 },
  { x: 257, y: 38, r: 1.8 },
  { x: 380, y: 204, r: 2 },
  { x: 74, y: 120, r: 1.5 },
  { x: 428, y: 138, r: 1.7 },
  { x: 196, y: 198, r: 1.6 },
  { x: 312, y: 58, r: 1.4 }
]

export function ConstellationBanner({
  clips,
  onSelectClip,
  onExplore
}: {
  clips: Clip[]
  onSelectClip: (clip: Clip) => void
  onExplore: () => void
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const previewClips = useMemo(() => clips.slice(0, 12).reverse(), [clips])
  const nodes = useMemo(() => layoutNodes(previewClips, 490, 250), [previewClips])
  const mainPath = useMemo(() => buildCurvePath(nodes), [nodes])
  const uniqueCategories = useMemo(
    () => new Set(clips.map(clip => clip.category)).size,
    [clips]
  )
  const hoveredNode = nodes.find(node => node.clip.id === hoveredId)

  return (
    <section className="constellation">
      <div className="const-copy">
        <div className="section-kicker">
          A LITTLE SOMETHING DIFFERENT <span>✳</span>
        </div>
        <h2>
          Your memories,
          <br />
          <i>in constellation.</i>
        </h2>
        <p>
          We extract the dominant color signature from every clip and weave your library into a
          living map. Hover any star or click to jump straight into playback.
        </p>
        <button onClick={onExplore}>
          Explore your constellation <ArrowUpRight size={15} />
        </button>
      </div>

      <div className="const-art">
        <svg viewBox="0 0 490 250" role="img" aria-label="Interactive constellation map of your saved videos">
          {AMBIENT_STARS.map((star, i) => (
            <circle key={i} className="const-star" cx={star.x} cy={star.y} r={star.r} />
          ))}

          {nodes.length > 0 ? (
            <>
              {mainPath && <path className="const-line" d={mainPath} />}
              {CATEGORIES.map(category => {
                const group = nodes.filter(node => node.clip.category === category)
                if (group.length < 2) return null
                return (
                  <path key={category} className="const-line faint" d={buildCurvePath(group)} />
                )
              })}
              {nodes.map(node => {
                const isHovered = hoveredId === node.clip.id
                return (
                  <g
                    key={node.clip.id}
                    className="const-interactive-node"
                    onMouseEnter={() => setHoveredId(node.clip.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => onSelectClip(node.clip)}
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.r + (isHovered ? 10 : 6)}
                      fill={node.color}
                      opacity={isHovered ? 0.24 : 0.1}
                    />
                    <circle
                      className="const-node"
                      cx={node.x}
                      cy={node.y}
                      r={isHovered ? node.r + 2.5 : node.r}
                      fill={node.color}
                    />
                  </g>
                )
              })}
            </>
          ) : (
            <>
              <path
                className="const-line"
                d="M46 184 C113 155 115 75 187 97 S267 205 319 134 S393 39 449 76"
              />
              <circle className="const-node node-a" cx="46" cy="184" r="7" />
              <circle className="const-node node-b" cx="187" cy="97" r="10" />
              <circle className="const-node node-c" cx="319" cy="134" r="8" />
              <circle className="const-node node-d" cx="449" cy="76" r="9" />
            </>
          )}
        </svg>

        {hoveredNode ? (
          <div className="const-tooltip">
            <span className="const-tooltip-dot" style={{ background: hoveredNode.color }} />
            <div>
              <strong>{hoveredNode.clip.title}</strong>
              <small>
                {hoveredNode.clip.category} · {hoveredNode.clip.duration}
              </small>
            </div>
          </div>
        ) : nodes.length > 0 ? (
          <>
            {nodes.slice(0, 3).map((node, index) => (
              <button
                key={node.clip.id}
                className={`const-label const-label-btn label-${['a', 'b', 'c'][index]}`}
                onClick={() => onSelectClip(node.clip)}
              >
                {node.clip.title.slice(0, 22)} · {node.clip.duration}
              </button>
            ))}
          </>
        ) : (
          <div className="const-label label-b">upload your first clip to light up the map</div>
        )}

        <div className="const-count">
          <Sparkles size={13} />{' '}
          {clips.length > 0
            ? `${clips.length} star${clips.length === 1 ? '' : 's'} · ${uniqueCategories} cluster${uniqueCategories === 1 ? '' : 's'}`
            : 'waiting for your first clip'}
        </div>
      </div>
    </section>
  )
}

export function ConstellationExplorer({
  clips,
  onSelectClip,
  onUploadClick
}: {
  clips: Clip[]
  onSelectClip: (clip: Clip) => void
  onUploadClick: () => void
}) {
  const [categoryFilter, setCategoryFilter] = useState<string>('All')
  const [toneFilter, setToneFilter] = useState<string>('All')
  const [activeId, setActiveId] = useState<string | null>(clips[0]?.id || null)

  const filtered = useMemo(
    () =>
      clips
        .filter(clip => (categoryFilter === 'All' || clip.category === categoryFilter))
        .filter(clip => (toneFilter === 'All' || clip.tone === toneFilter))
        .slice()
        .reverse(),
    [clips, categoryFilter, toneFilter]
  )

  const nodes = useMemo(() => layoutNodes(filtered, 920, 420), [filtered])
  const mainPath = useMemo(() => buildCurvePath(nodes), [nodes])
  const activeNode =
    nodes.find(node => node.clip.id === activeId) || nodes[nodes.length - 1] || null

  const toneCounts = useMemo(() => {
    const counts: Record<string, number> = { sage: 0, sand: 0, lilac: 0, blue: 0 }
    for (const clip of clips) counts[clip.tone] = (counts[clip.tone] || 0) + 1
    return counts
  }, [clips])

  return (
    <section className="explorer-page">
      <div className="library-head">
        <div>
          <div className="section-kicker">
            MEMORY CONSTELLATION <span>✳</span>
          </div>
          <h2>
            Your living sky <span className="count">{filtered.length}</span>
          </h2>
          <p className="section-sub">
            Every saved video becomes a star tinted by its own frames. Click any node to inspect or
            play.
          </p>
        </div>
        <div className="explorer-filters">
          <div className="pill-group">
            {['All', ...CATEGORIES].map(cat => (
              <button
                key={cat}
                className={categoryFilter === cat ? 'active' : ''}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="pill-group">
            <button
              className={toneFilter === 'All' ? 'active' : ''}
              onClick={() => setToneFilter('All')}
            >
              All tones
            </button>
            {(['sage', 'sand', 'lilac', 'blue'] as const).map(tone => (
              <button
                key={tone}
                className={toneFilter === tone ? 'active' : ''}
                onClick={() => setToneFilter(tone)}
              >
                <i className={`tag-dot ${tone}`} /> {tone} ({toneCounts[tone] || 0})
              </button>
            ))}
          </div>
        </div>
      </div>

      {nodes.length > 0 ? (
        <div className="explorer-layout">
          <div className="explorer-canvas">
            <svg viewBox="0 0 920 420" role="img" aria-label="Full memory constellation map">
              {AMBIENT_STARS.map((star, i) => (
                <circle
                  key={`a-${i}`}
                  className="const-star"
                  cx={star.x * 1.85}
                  cy={star.y * 1.65}
                  r={star.r}
                />
              ))}
              {mainPath && <path className="const-line" d={mainPath} />}
              {CATEGORIES.map(category => {
                const group = nodes.filter(node => node.clip.category === category)
                if (group.length < 2) return null
                return (
                  <path key={category} className="const-line faint" d={buildCurvePath(group)} />
                )
              })}
              {nodes.map(node => {
                const isSelected = activeNode?.clip.id === node.clip.id
                return (
                  <g
                    key={node.clip.id}
                    className="const-interactive-node"
                    onMouseEnter={() => setActiveId(node.clip.id)}
                    onClick={() => {
                      setActiveId(node.clip.id)
                      onSelectClip(node.clip)
                    }}
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.r + (isSelected ? 16 : 8)}
                      fill={node.color}
                      opacity={isSelected ? 0.25 : 0.11}
                    />
                    <circle
                      className="const-node"
                      cx={node.x}
                      cy={node.y}
                      r={isSelected ? node.r + 3 : node.r}
                      fill={node.color}
                    />
                    <text
                      x={node.x}
                      y={node.y + node.r + 18}
                      textAnchor="middle"
                      className={`explorer-svg-label ${isSelected ? 'selected' : ''}`}
                    >
                      {node.clip.title.slice(0, 18)}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>

          {activeNode && (
            <div className="explorer-inspector">
              <div
                className={`explorer-thumb ${activeNode.clip.tone}`}
                style={
                  activeNode.clip.thumbnailUrl
                    ? { backgroundImage: `url("${activeNode.clip.thumbnailUrl}")` }
                    : undefined
                }
                onClick={() => onSelectClip(activeNode.clip)}
              >
                <span className="play-button visible">
                  <Play size={17} fill="currentColor" />
                </span>
                <span className="duration">{activeNode.clip.duration}</span>
              </div>
              <div className="explorer-inspector-body">
                <span className="section-kicker">
                  {activeNode.clip.category.toUpperCase()} · {activeNode.clip.size}
                </span>
                <h3>{activeNode.clip.title}</h3>
                <p>{activeNode.clip.date}</p>
                <div className="color-signature-row">
                  <span
                    className="color-swatch"
                    style={{ background: activeNode.color }}
                  />
                  <span>
                    Color signature: <b>{activeNode.clip.tone}</b> ({activeNode.color})
                  </span>
                </div>
                <button
                  className="upload-btn explorer-play-btn"
                  onClick={() => onSelectClip(activeNode.clip)}
                >
                  <Play size={14} fill="currentColor" /> Play memory
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="empty">
          <div className="empty-icon">
            <Film size={22} />
          </div>
          <h3>No stars match this filter</h3>
          <p>Try clearing your filters or upload a new clip to expand your constellation.</p>
          <button className="upload-btn" onClick={onUploadClick}>
            Add a video
          </button>
        </div>
      )}
    </section>
  )
}
