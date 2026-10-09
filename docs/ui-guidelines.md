# UI guidelines

IndexSphere uses [shadcn/ui](https://ui.shadcn.com) (new-york style, neutral palette) on Tailwind CSS v4.
These rules keep every page consistent. When in doubt, copy an existing page that follows them, such as **Vulnerabilities** or **ClickHouse → Table advisor**.

## Layout

- The app shell (`MainLayout`) already provides page padding (`p-4 md:p-6`), a max width and vertical spacing (`space-y-6`).
  A page's root element is a fragment or `<div className="space-y-6">`. **Never add `p-6`, `container` or `min-h-screen` on a page.**
- Each page starts with `<PageHeader title description actions />` from `@/components/app`.
  - The title is sentence case and short ("Index advisor", not "Index Intelligence Advisor").
  - The description is one sentence saying what the page is for.
  - Primary actions go in `actions`: one primary button at most, the rest `variant="outline"`.
  - No decorative icon next to the title. The sidebar and breadcrumb already identify the page.
- Group related content in `Card`s. Use `CardHeader` + `CardTitle` (`text-base`) + optional `CardDescription`.
- Grids: `grid gap-4 md:grid-cols-2 xl:grid-cols-4` for stats; `gap-6` between larger cards.
- Everything must work at 390 px wide: stack columns below `md`, let tables scroll horizontally inside their
  card (`overflow-x-auto`), and avoid fixed widths.

## Colour

- Use neutral tokens: `bg-background`, `bg-muted`, `text-muted-foreground`, `border`. **Never** hard-code
  `bg-blue-500`, `text-purple-600`, gradients or coloured icon tiles.
- Colour carries meaning only: `text-success`, `text-warning`, `text-destructive`, `text-info`
  (and `bg-*/15` tints of them). Cluster health uses `<HealthBadge status>` / `<StatusDot>`.
  Severities use `<SeverityBadge level>`.
- Icons are `text-muted-foreground`, `h-4 w-4`. No multi-coloured icon sets.
- Charts use `--chart-1…5`.

## Components

| Need | Use |
|---|---|
| Page title + actions | `PageHeader` |
| Metric tile | `StatCard` (label, value, hint, muted icon, optional `tone`) inside `StatGrid` |
| Cluster health | `HealthBadge` / `StatusDot` |
| Severity / result | `SeverityBadge` |
| Nothing to show / not connected | `EmptyState` (icon, title, description, action) |
| Data tables | `@/components/ui/table` (`Table`, `TableHeader`, `TableRow`, `TableHead`, `TableCell`) |
| Forms | `Label` + `Input` / `Select` / `Textarea` / `Switch` in `grid gap-2` blocks |
| Errors | `Alert variant="destructive"` with `AlertCircle` |
| Loading | `Skeleton` for content, `Loader2 animate-spin` inside buttons |
| Code / commands | `<pre className="rounded-md bg-muted p-3 font-mono text-xs">` |

## Copy

- Sentence case everywhere (buttons, titles, tabs): "Add connection", not "Add Connection".
- Be specific and calm: "No cluster connected", plus an action to connect. No exclamation marks or emoji,
  no marketing phrases ("powerful", "blazing fast", "AI-powered").
- Numbers: `toLocaleString()` for counts, binary units (KiB, MiB, GiB) for sizes, `tabular-nums` for aligned figures.

## Behaviour

- Every async action shows progress (disabled button + spinner) and surfaces errors inline.
- Destructive actions need confirmation and use `variant="destructive"`.
- Polling must never overlap: guard with an in-flight ref and pause when `document.hidden`.
- Wrap `localStorage` access in `try/catch`.
- `<Select.Item>` values must be non-empty strings. Use a sentinel such as `"__all__"` for "all".
