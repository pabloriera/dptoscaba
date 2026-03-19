const DETAIL_CSV_CANDIDATES = [
  "output/rent_listings_detailed.csv",
  "../output/rent_listings_detailed.csv"
];

const state = {
  currency: "USD",
  sort: "median-desc",
  detailRows: [],
  maxRange: null
};

const heroStats = document.getElementById("hero-stats");
const currencySelect = document.getElementById("currency-select");
const sortSelect = document.getElementById("sort-select");
const rangeMaxInput = document.getElementById("range-max");
const rangeMaxValue = document.getElementById("range-max-value");

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatValue(value, currency) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  if (currency === "ARS") {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0
    }).format(value);
  }

  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function toCurrency(row, currency) {
  if (currency === "ARS") {
    return parseNumber(row.rent_amount_ars);
  }
  return parseNumber(row.rent_amount_usd);
}

function median(values) {
  if (!values.length) {
    return null;
  }

  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 0) {
    return (ordered[middle - 1] + ordered[middle]) / 2;
  }
  return ordered[middle];
}

function quantile(sortedValues, q) {
  if (!sortedValues.length) {
    return null;
  }

  const index = (sortedValues.length - 1) * q;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) {
    return sortedValues[low];
  }
  const weight = index - low;
  return sortedValues[low] * (1 - weight) + sortedValues[high] * weight;
}

function normalizeBarrio(value) {
  return (value || "").trim().toLowerCase();
}

function computeNeighborhoodStats() {
  const grouped = d3.group(
    state.detailRows.filter((row) => {
      const barrio = normalizeBarrio(row.barrio);
      if (!barrio || barrio === "otro" || barrio === "otros") {
        return false;
      }

      const amount = toCurrency(row, state.currency);
      return Number.isFinite(amount) && amount > 1;
    }),
    (row) => row.barrio.trim()
  );

  const stats = [];

  for (const [barrio, rows] of grouped.entries()) {
    const values = rows
      .map((row) => toCurrency(row, state.currency))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);

    if (!values.length) {
      continue;
    }

    stats.push({
      barrio,
      count: values.length,
      min: values[0],
      q1: quantile(values, 0.25),
      median: quantile(values, 0.5),
      q3: quantile(values, 0.75),
      max: values[values.length - 1]
    });
  }

  if (state.sort === "median-asc") {
    stats.sort((a, b) => a.median - b.median);
  } else if (state.sort === "name-asc") {
    stats.sort((a, b) => d3.ascending(a.barrio, b.barrio));
  } else {
    stats.sort((a, b) => b.median - a.median);
  }

  return stats;
}

function renderHeroStats() {
  const listings = state.detailRows.length;
  const barrios = new Set(
    state.detailRows
      .map((row) => normalizeBarrio(row.barrio))
      .filter((value) => value && value !== "otro" && value !== "otros")
  ).size;
  const currentValues = state.detailRows
    .map((row) => toCurrency(row, state.currency))
    .filter((value) => Number.isFinite(value) && value > 1);
  const currentAreas = state.detailRows
    .map((row) => parseNumber(row.total_area_m2))
    .filter((value) => Number.isFinite(value));

  const metrics = [
    {
      label: "Departamentos publicados",
      value: new Intl.NumberFormat("es-AR").format(listings)
    },
    {
      label: "Barrios",
      value: new Intl.NumberFormat("es-AR").format(barrios)
    },
    {
      label: "Alquiler promedio",
      value: formatValue(median(currentValues), state.currency)
    },
    {
      label: "Metros cuadrados promedio",
      value: `${Math.round(median(currentAreas) || 0)} m²`
    }
  ];

  heroStats.innerHTML = metrics
    .map(
      (metric) => `
        <div class="metric">
          <span class="metric-value">${metric.value}</span>
          <span class="metric-label">${metric.label}</span>
        </div>
      `
    )
    .join("");
}

function renderChartSummary(stats) {
  const container = document.getElementById("chart-summary");
  const units = stats.reduce((sum, row) => sum + row.count, 0);
  const medianOfMedians = median(stats.map((row) => row.median).filter(Number.isFinite));
  container.textContent = `${new Intl.NumberFormat("es-AR").format(units)} unidades en ${stats.length} barrios. La mediana entre barrios es ${formatValue(medianOfMedians, state.currency)}.`;
}

function getRangeStep(currency) {
  return currency === "ARS" ? 10000 : 10;
}

function syncRangeControl(stats) {
  const dataMax = d3.max(stats, (row) => row.max) || 0;
  const step = getRangeStep(state.currency);
  const minValue = Math.max(step, Math.ceil((dataMax * 0.1) / step) * step);

  if (!Number.isFinite(state.maxRange) || state.maxRange <= 0) {
    state.maxRange = dataMax;
  }

  state.maxRange = Math.max(minValue, Math.min(dataMax, state.maxRange));

  rangeMaxInput.min = String(minValue);
  rangeMaxInput.max = String(dataMax);
  rangeMaxInput.step = String(step);
  rangeMaxInput.value = String(state.maxRange);
  rangeMaxValue.textContent = formatValue(state.maxRange, state.currency);
}

function drawBoxplot(svgId, stats, title, note) {
  const svg = d3.select(`#${svgId}`);
  svg.selectAll("*").remove();

  const width = 1120;
  const margin = { top: 84, right: 26, bottom: 56, left: 210 };
  const rowHeight = 22;
  const chartHeight = Math.max(420, stats.length * rowHeight);
  const height = margin.top + chartHeight + margin.bottom;

  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const maxValue = d3.max(stats, (row) => row.max) || 0;
  const visibleMax = Number.isFinite(state.maxRange) ? Math.min(state.maxRange, maxValue) : maxValue;
  const x = d3.scaleLinear().domain([0, visibleMax]).nice().range([margin.left, width - margin.right]).clamp(true);
  const y = d3
    .scaleBand()
    .domain(stats.map((row) => row.barrio))
    .range([margin.top, margin.top + chartHeight])
    .padding(0.42);

  const grid = d3.axisBottom(x).ticks(8).tickSize(-(chartHeight)).tickFormat("");
  svg
    .append("g")
    .attr("class", "grid")
    .attr("transform", `translate(0, ${margin.top + chartHeight})`)
    .call(grid);

  const axisX = d3.axisBottom(x).ticks(8).tickFormat((value) => d3.format(",.0f")(value));

  svg
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0, ${margin.top + chartHeight})`)
    .call(axisX);

  svg
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left}, 0)`)
    .call(d3.axisLeft(y).tickSize(0));

  const rows = svg
    .append("g")
    .selectAll("g")
    .data(stats)
    .join("g")
    .attr("transform", (row) => `translate(0, ${y(row.barrio) + y.bandwidth() / 2})`);

  rows
    .append("line")
    .attr("class", "whisker")
    .attr("x1", (row) => x(row.min))
    .attr("x2", (row) => x(row.max))
    .attr("y1", 0)
    .attr("y2", 0);

  rows
    .append("line")
    .attr("class", "cap-line")
    .attr("x1", (row) => x(row.min))
    .attr("x2", (row) => x(row.min))
    .attr("y1", -6)
    .attr("y2", 6);

  rows
    .append("line")
    .attr("class", "cap-line")
    .attr("x1", (row) => x(row.max))
    .attr("x2", (row) => x(row.max))
    .attr("y1", -6)
    .attr("y2", 6);

  rows
    .append("rect")
    .attr("class", "box-shape")
    .attr("x", (row) => x(row.q1))
    .attr("y", -7)
    .attr("width", (row) => Math.max(1, x(row.q3) - x(row.q1)))
    .attr("height", 14);

  rows
    .append("line")
    .attr("class", "median-line")
    .attr("x1", (row) => x(row.median))
    .attr("x2", (row) => x(row.median))
    .attr("y1", -9)
    .attr("y2", 9);

  rows.append("title").text(
    (row) => `${row.barrio}\nUnidades: ${row.count}\nMediana: ${formatValue(row.median, state.currency)}\nRango central: ${formatValue(row.q1, state.currency)} a ${formatValue(row.q3, state.currency)}\nRango completo: ${formatValue(row.min, state.currency)} a ${formatValue(row.max, state.currency)}`
  );

  svg
    .append("text")
    .attr("class", "chart-title")
    .attr("x", margin.left)
    .attr("y", 34)
    .text(title);

  svg
    .append("text")
    .attr("class", "chart-subtitle")
    .attr("x", margin.left)
    .attr("y", 58)
    .text(`${new Intl.NumberFormat("es-AR").format(stats.reduce((sum, row) => sum + row.count, 0))} unidades mostradas`);

  svg
    .append("text")
    .attr("class", "axis-label")
    .attr("x", width - margin.right)
    .attr("y", height - 14)
    .attr("text-anchor", "end")
    .text(`Alquiler publicado por mes (${state.currency})`);

  svg
    .append("text")
    .attr("class", "chart-note")
    .attr("x", margin.left)
    .attr("y", height - 14)
    .text(note);
}

function renderCharts() {
  const allStats = computeNeighborhoodStats();
  renderChartSummary(allStats);
  syncRangeControl(allStats);

  drawBoxplot(
    "boxplot-all",
    allStats,
    `Alquileres publicados por barrio en ${state.currency}`,
    `Pasá el cursor sobre cada barrio para ver más detalle. Límite visible: ${formatValue(state.maxRange, state.currency)}.`
  );
}

function render() {
  renderHeroStats();
  renderCharts();
}

async function loadFirstAvailableCsv(paths) {
  let lastError = null;

  for (const path of paths) {
    try {
      return await d3.csv(path);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function loadData() {
  const detailRows = await loadFirstAvailableCsv(DETAIL_CSV_CANDIDATES);
  state.detailRows = detailRows;

  currencySelect.addEventListener("change", (event) => {
    state.currency = event.target.value;
    state.maxRange = null;
    render();
  });

  sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });

  rangeMaxInput.addEventListener("input", (event) => {
    state.maxRange = parseNumber(event.target.value);
    renderCharts();
  });

  render();
}

loadData().catch((error) => {
  console.error(error);
  heroStats.innerHTML = `
    <div class="metric">
      <span class="metric-value">Sin datos</span>
      <span class="metric-label">No fue posible cargar la información del sitio.</span>
    </div>
  `;
});