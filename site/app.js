const DETAIL_CSV_CANDIDATES = [
  "output/rent_listings_detailed.csv",
  "../output/rent_listings_detailed.csv"
];

const GEOJSON_CANDIDATES = [
  "data/caba_barrios.geojson",
  "../data/caba_barrios.geojson"
];

const USD_TO_ARS = 1400;
const ANALYSIS_CONFIG = {
  rent: {
    heroLabel: "Alquiler mediano",
    chartTitle: "Alquileres publicados por barrio",
    axisLabel: "Alquiler publicado por mes",
    mapDescription: "El color muestra la mediana del alquiler publicado en cada barrio. Pasá el cursor para ver el valor típico, el rango publicado y la cantidad de unidades relevadas.",
    emptyMapMessage: "No hay datos suficientes para pintar el mapa de alquileres.",
    summaryLabel: "alquileres"
  },
  expenses: {
    heroLabel: "Expensas medianas",
    chartTitle: "Expensas publicadas por barrio",
    axisLabel: "Expensas publicadas por mes",
    mapDescription: "El color muestra la mediana de las expensas publicadas en cada barrio. Pasá el cursor para ver el valor típico, el rango publicado y la cantidad de unidades relevadas.",
    emptyMapMessage: "No hay datos suficientes para pintar el mapa de expensas.",
    summaryLabel: "expensas"
  }
};
const MAP_COLORS = [
  "#51d8f6",
  "#32a8df",
  "#6f7fc2",
  "#9a6ab0",
  "#d74a7d",
  "#b10b4f"
];
const MAP_LEGEND_MAX_USD = 1000;
const MAP_HIGHLIGHTED_BARRIOS = new Set([
  "nunez",
  "agronomia",
  "palermo",
  "recoleta",
  "puerto madero",
  "floresta",
  "villa lugano",
  "parque avellaneda",
  "parque chacabuco",
  "boedo",
  "pompeya"
]);

const state = {
  analysis: "rent",
  currency: "USD",
  sort: "median-desc",
  detailRows: [],
  geoData: null,
  maxRange: null
};

const heroStats = document.getElementById("hero-stats");
const analysisSelect = document.getElementById("analysis-select");
const currencySelect = document.getElementById("currency-select");
const sortSelect = document.getElementById("sort-select");
const rangeMaxInput = document.getElementById("range-max");
const rangeMaxValue = document.getElementById("range-max-value");
const boxplotTooltip = document.getElementById("boxplot-tooltip");
const mapTooltip = document.getElementById("barrio-map-tooltip");
const mapDescription = document.getElementById("map-description");
const interpolateMapColor = d3.interpolateRgbBasis(MAP_COLORS);

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

function convertAmount(amount, sourceCurrency, targetCurrency) {
  if (!Number.isFinite(amount)) {
    return null;
  }

  if (targetCurrency === "ARS") {
    if (sourceCurrency === "$") {
      return amount;
    }
    if (sourceCurrency === "USD") {
      return amount * USD_TO_ARS;
    }
    return null;
  }

  if (targetCurrency === "USD") {
    if (sourceCurrency === "USD") {
      return amount;
    }
    if (sourceCurrency === "$") {
      return amount / USD_TO_ARS;
    }
    return null;
  }

  return null;
}

function getAnalysisConfig() {
  return ANALYSIS_CONFIG[state.analysis] || ANALYSIS_CONFIG.rent;
}

function getMetricValue(row, currency) {
  if (state.analysis === "rent") {
    const field = currency === "ARS" ? "rent_amount_ars" : "rent_amount_usd";
    const precomputed = parseNumber(row[field]);
    if (Number.isFinite(precomputed)) {
      return precomputed;
    }

    return convertAmount(parseNumber(row.rent_amount), row.rent_currency, currency);
  }

  return convertAmount(parseNumber(row.expenses_amount), row.expenses_currency, currency);
}

function getMapLegendMax(currency) {
  if (currency === "ARS") {
    return MAP_LEGEND_MAX_USD * USD_TO_ARS;
  }

  return MAP_LEGEND_MAX_USD;
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

function formatBarrioName(value) {
  return (value || "")
    .trim()
    .toLocaleLowerCase("es-AR")
    .replace(/(^|[\s\/-])(\p{L})/gu, (match, separator, letter) => `${separator}${letter.toLocaleUpperCase("es-AR")}`);
}

function normalizeGeoKey(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function interpolateLogValue(minValue, maxValue, t) {
  if (minValue <= 0 || maxValue <= 0) {
    return minValue + (maxValue - minValue) * t;
  }

  return minValue * (maxValue / minValue) ** t;
}

function roundLegendTick(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return value;
  }

  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const niceSteps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  let closestStep = niceSteps[0];
  let smallestDistance = Math.abs(scaled - closestStep);

  for (const step of niceSteps.slice(1)) {
    const distance = Math.abs(scaled - step);
    if (distance < smallestDistance) {
      closestStep = step;
      smallestDistance = distance;
    }
  }

  return closestStep * power;
}

function buildLogLegendTicks(minValue, maxValue) {
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue <= 0 || maxValue <= 0) {
    return [minValue, maxValue].filter(Number.isFinite);
  }

  const ticks = [roundLegendTick(minValue)];
  const ratio = Math.sqrt(2);
  let current = Math.max(minValue, ticks[0]);

  while (current < maxValue) {
    const next = roundLegendTick(current * ratio);
    if (next <= ticks[ticks.length - 1]) {
      current *= ratio;
      continue;
    }

    ticks.push(next);
    current = next;
  }

  ticks[0] = minValue;

  const filteredTicks = ticks.filter((value) => value >= minValue && value <= maxValue);
  if (!filteredTicks.length || filteredTicks[filteredTicks.length - 1] !== maxValue) {
    filteredTicks.push(maxValue);
  }

  return Array.from(new Set(filteredTicks)).sort((a, b) => a - b);
}

function computeNeighborhoodStats() {
  const grouped = d3.group(
    state.detailRows.filter((row) => {
      const barrio = normalizeBarrio(row.barrio);
      if (!barrio || barrio === "otro" || barrio === "otros") {
        return false;
      }

      const amount = getMetricValue(row, state.currency);
      return Number.isFinite(amount) && amount > 1;
    }),
    (row) => row.barrio.trim()
  );

  const stats = [];

  for (const [barrio, rows] of grouped.entries()) {
    const values = rows
      .map((row) => getMetricValue(row, state.currency))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);

    if (!values.length) {
      continue;
    }

    stats.push({
      barrio: formatBarrioName(barrio),
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

function computeMapStats(stats) {
  return new Map(
    stats.map((row) => [
      normalizeGeoKey(row.barrio),
      {
        barrio: row.barrio,
        count: row.count,
        min: row.min,
        median: row.median,
        max: row.max
      }
    ])
  );
}

function renderHeroStats() {
  const listings = state.detailRows.length;
  const barrios = new Set(
    state.detailRows
      .map((row) => normalizeBarrio(row.barrio))
      .filter((value) => value && value !== "otro" && value !== "otros")
  ).size;
  const currentValues = state.detailRows
    .map((row) => getMetricValue(row, state.currency))
    .filter((value) => Number.isFinite(value) && value > 1);
  const currentAreas = state.detailRows
    .map((row) => parseNumber(row.total_area_m2))
    .filter((value) => Number.isFinite(value));

  const analysisConfig = getAnalysisConfig();

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
      label: analysisConfig.heroLabel,
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
  if (!container) {
    return;
  }

  const units = stats.reduce((sum, row) => sum + row.count, 0);
  const medianOfMedians = median(stats.map((row) => row.median).filter(Number.isFinite));
  const analysisConfig = getAnalysisConfig();
  container.textContent = `${new Intl.NumberFormat("es-AR").format(units)} unidades en ${stats.length} barrios. La mediana entre barrios para ${analysisConfig.summaryLabel} es ${formatValue(medianOfMedians, state.currency)}.`;
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

function showBoxplotTooltip(event, row) {
  if (!boxplotTooltip || !row) {
    return;
  }

  boxplotTooltip.hidden = false;
  boxplotTooltip.innerHTML = `
    <strong>${row.barrio}</strong>
    <span>Unidades: ${new Intl.NumberFormat("es-AR").format(row.count)}</span>
    <span>Mediana: ${formatValue(row.median, state.currency)}</span>
    <span>Rango central: ${formatValue(row.q1, state.currency)} a ${formatValue(row.q3, state.currency)}</span>
    <span>Rango completo: ${formatValue(row.min, state.currency)} a ${formatValue(row.max, state.currency)}</span>
  `;

  boxplotTooltip.style.left = `${event.clientX + 16}px`;
  boxplotTooltip.style.top = `${event.clientY + 16}px`;
}

function hideBoxplotTooltip() {
  if (!boxplotTooltip) {
    return;
  }

  boxplotTooltip.hidden = true;
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
    .append("rect")
    .attr("class", "boxplot-hitbox")
    .attr("x", margin.left)
    .attr("y", -Math.max(12, y.bandwidth()))
    .attr("width", width - margin.left - margin.right)
    .attr("height", Math.max(24, y.bandwidth() * 2))
    .on("mouseenter", function (event, row) {
      showBoxplotTooltip(event, row);
    })
    .on("mousemove", function (event, row) {
      showBoxplotTooltip(event, row);
    })
    .on("mouseleave", function () {
      hideBoxplotTooltip();
    });

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
    .text(`${getAnalysisConfig().axisLabel} (${state.currency})`);

  svg
    .append("text")
    .attr("class", "chart-note")
    .attr("x", margin.left)
    .attr("y", height - 14)
    .text(note);
}

function showMapTooltip(event, stats) {
  if (!mapTooltip || !stats) {
    return;
  }

  mapTooltip.hidden = false;
  mapTooltip.innerHTML = `
    <strong>${stats.barrio}</strong>
    <span>Mediana: ${formatValue(stats.median, state.currency)}</span>
    <span>Rango: ${formatValue(stats.min, state.currency)} a ${formatValue(stats.max, state.currency)}</span>
    <span>Unidades: ${new Intl.NumberFormat("es-AR").format(stats.count)}</span>
  `;

  const offsetX = 18;
  const offsetY = 18;
  mapTooltip.style.left = `${event.offsetX + offsetX}px`;
  mapTooltip.style.top = `${event.offsetY + offsetY}px`;
}

function hideMapTooltip() {
  if (!mapTooltip) {
    return;
  }

  mapTooltip.hidden = true;
}

function drawBarrioMap(stats) {
  const svg = d3.select("#barrio-map");
  svg.selectAll("*").remove();

  if (!state.geoData) {
    svg
      .attr("viewBox", "0 0 1120 220")
      .append("text")
      .attr("class", "map-empty")
      .attr("x", 40)
      .attr("y", 120)
      .text("No fue posible cargar el mapa de barrios.");
    hideMapTooltip();
    return;
  }

  const width = 1120;
  const height = 860;
  const margin = { top: 20, right: 28, bottom: 120, left: 28 };

  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const projection = d3.geoMercator().fitExtent(
    [
      [margin.left, margin.top],
      [width - margin.right, height - margin.bottom]
    ],
    state.geoData
  );
  const path = d3.geoPath(projection);
  const statsByBarrio = computeMapStats(stats);

  const enrichedFeatures = state.geoData.features.map((feature) => {
    const barrioName = feature?.properties?.BARRIO || "";
    const key = normalizeGeoKey(barrioName);
    return {
      feature,
      key,
      barrioName: formatBarrioName(barrioName),
      stats: statsByBarrio.get(key) || null
    };
  });

  const values = enrichedFeatures
    .map((item) => item.stats?.median)
    .filter((value) => Number.isFinite(value));

  if (!values.length) {
    svg
      .append("text")
      .attr("class", "map-empty")
      .attr("x", 40)
      .attr("y", 120)
      .text(getAnalysisConfig().emptyMapMessage);
    hideMapTooltip();
    return;
  }

  const sortedValues = [...values].sort((a, b) => a - b);
  const minValue = sortedValues[0];
  const rawMaxValue = sortedValues[sortedValues.length - 1];
  const scaleMaxValue = Math.max(minValue, Math.min(rawMaxValue, getMapLegendMax(state.currency)));
  const hasCappedLegend = rawMaxValue > scaleMaxValue;
  const colorScale = d3
    .scaleSequentialLog()
    .domain([minValue, scaleMaxValue || minValue + 1])
    .interpolator(interpolateMapColor)
    .clamp(true);

  const mapGroup = svg.append("g").attr("class", "map-group");

  mapGroup
    .selectAll("path")
    .data(enrichedFeatures)
    .join("path")
    .attr("class", (item) => `barrio-shape${item.stats ? "" : " barrio-shape--empty"}`)
    .attr("d", (item) => path(item.feature))
    .attr("fill", (item) => (item.stats ? colorScale(item.stats.median) : "#e5eaef"))
    .on("mouseenter", function (event, item) {
      d3.select(this).classed("barrio-shape--active", true);
      showMapTooltip(event, item.stats || {
        barrio: item.barrioName,
        median: NaN,
        min: NaN,
        max: NaN,
        count: 0
      });
    })
    .on("mousemove", function (event, item) {
      showMapTooltip(event, item.stats || {
        barrio: item.barrioName,
        median: NaN,
        min: NaN,
        max: NaN,
        count: 0
      });
    })
    .on("mouseleave", function () {
      d3.select(this).classed("barrio-shape--active", false);
      hideMapTooltip();
    });

  mapGroup
    .selectAll("text")
    .data(enrichedFeatures.filter((item) => item.stats))
    .join("text")
    .attr("class", (item) => {
      const key = normalizeGeoKey(item.barrioName);
      return MAP_HIGHLIGHTED_BARRIOS.has(key) ? "map-label map-label--highlighted" : "map-label";
    })
    .attr("transform", (item) => {
      const centroid = path.centroid(item.feature);
      return `translate(${centroid[0]}, ${centroid[1]})`;
    })
    .attr("text-anchor", "middle")
    .each(function (item) {
      const label = d3.select(this);
      const key = normalizeGeoKey(item.barrioName);
      const isHighlighted = MAP_HIGHLIGHTED_BARRIOS.has(key);

      label.selectAll("tspan").remove();

      label
        .append("tspan")
        .attr("x", 0)
        .attr("dy", isHighlighted ? "-0.2em" : "0.35em")
        .text(item.barrioName);

      if (isHighlighted) {
        label
          .append("tspan")
          .attr("class", "map-price-label")
          .attr("x", 0)
          .attr("dy", "1.15em")
          .text(formatValue(item.stats.median, state.currency));
      }
    });

  const legendWidth = 24;
  const legendHeight = 240;
  const legendX = width - margin.right - legendWidth - 72;
  const legendY = margin.top + 140;
  const defs = svg.append("defs");
  const gradient = defs
    .append("linearGradient")
    .attr("id", "map-legend-gradient")
    .attr("x1", "0%")
    .attr("y1", "100%")
    .attr("x2", "0%")
    .attr("y2", "0%");

  gradient
    .selectAll("stop")
    .data(d3.range(0, 1.01, 0.1))
    .join("stop")
    .attr("offset", (value) => `${value * 100}%`)
    .attr("stop-color", (value) => colorScale(interpolateLogValue(minValue, scaleMaxValue, value)));

  svg
    .append("text")
    .attr("class", "map-legend-title")
    .attr("x", legendX + legendWidth / 2)
    .attr("y", legendY - 18)
    .attr("text-anchor", "middle")
    .text(`Mediana de ${getAnalysisConfig().summaryLabel} (${state.currency})`);


  svg
    .append("rect")
    .attr("class", "map-legend-ramp")
    .attr("x", legendX)
    .attr("y", legendY)
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .attr("rx", 999)
    .attr("fill", "url(#map-legend-gradient)");

  const legendScale = d3.scaleLog().domain([minValue, scaleMaxValue]).range([legendY + legendHeight, legendY]);
  const legendTickValues = buildLogLegendTicks(minValue, scaleMaxValue);
  const legendAxis = d3
    .axisLeft(legendScale)
    .tickValues(legendTickValues)
    .tickSize(8)
    .tickFormat((value) => {
      if (hasCappedLegend && value === scaleMaxValue) {
        return `${formatValue(value, state.currency)}+`;
      }

      return formatValue(value, state.currency);
    });

  svg
    .append("g")
    .attr("class", "map-legend-axis")
    .attr("transform", `translate(${legendX - 10}, 0)`)
    .call(legendAxis);

}

function renderCharts() {
  const allStats = computeNeighborhoodStats();
  syncRangeControl(allStats);
  const analysisConfig = getAnalysisConfig();

  drawBoxplot(
    "boxplot-all",
    allStats,
    `${analysisConfig.chartTitle} en ${state.currency}`,
    `Pasá el cursor sobre cada barrio para ver más detalle. Límite visible: ${formatValue(state.maxRange, state.currency)}.`
  );

  drawBarrioMap(allStats);
}

function render() {
  if (mapDescription) {
    mapDescription.textContent = getAnalysisConfig().mapDescription;
  }
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

async function loadFirstAvailableJson(paths) {
  let lastError = null;

  for (const path of paths) {
    try {
      return await d3.json(path);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function loadData() {
  const [detailRows, geoData] = await Promise.all([
    loadFirstAvailableCsv(DETAIL_CSV_CANDIDATES),
    loadFirstAvailableJson(GEOJSON_CANDIDATES).catch(() => null)
  ]);

  state.detailRows = detailRows;
  state.geoData = geoData;

  analysisSelect.addEventListener("change", (event) => {
    state.analysis = event.target.value;
    state.maxRange = null;
    render();
  });

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