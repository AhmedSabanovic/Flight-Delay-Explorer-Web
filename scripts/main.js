// Cache and state management
const dataCache = new Map();
let loadingQueue = new Set();
let visibleAirports = [];
let currentViewport = null;

Promise.all([
    d3.json("data/us-atlas.json")
]).then(function([us]) {
    let currentYear = 2020; 
    let airports = [];

    // Enhanced loadData with caching
    async function loadData(year) {
        updateLoadingStatus(true);
        
        if (dataCache.has(year)) {
            airports = dataCache.get(year);
            updateLoadingStatus(false);
            console.log(`Data for year ${year} loaded from cache.`);
            return Promise.resolve();
        }

        try {
            const data = await d3.csv(`data/flights_${year}.csv`);
            airports = processAirportData(data);
            dataCache.set(year, airports);
            
            // Predictive loading of adjacent years
            prefetchAdjacentYears(year);
            
            updateLoadingStatus(false);
            updateCacheStatus();
            console.log(`Data for year ${year} loaded and cached.`);
            return Promise.resolve();
        } catch (error) {
            console.error(`Error loading data for year ${year}:`, error);
            updateLoadingStatus(false);
            return Promise.reject(error);
        }
    }

    function parseConnections(connectionsStr) {
        try {
            return JSON.parse(connectionsStr.replace(/'/g, '"').replace(/^"|"$/g, ''));
        } catch (e) {
            console.error('Error parsing connections:', e);
            return [];
        }
    }

    function processAirportData(data) {
        return data.map(d => {
            try {
                return {
                    LATITUDE: parseFloat(d.LATITUDE) || null,
                    LONGITUDE: parseFloat(d.LONGITUDE) || null,
                    DELAY_PERCENTAGE: parseFloat(d.DELAY_PERCENTAGE) || 0,
                    pct_delayed: parseFloat(d.pct_delayed) || 0,
                    flights: parseInt(d.flights) || 0,
                    avg_delay: parseFloat(d.avg_delay) || 0,
                    delayed: parseInt(d.delayed) || 0,
                    ORIGIN: d.ORIGIN || "Unknown",
                    ORIGIN_CITY: d.ORIGIN_CITY || "Unknown", // Ensure valid origin city
                    AIRPORT: d.AIRPORT || "Unknown",
                    AIRLINE: d.AIRLINE || "Unknown", // Ensure valid airline
                    STATE: d.STATE || "Unknown", // Ensure valid state
                    connections: parseConnections(d.connections || "[]"), // Handle missing connections gracefully
                };
            } catch (error) {
                console.error("Error processing airport data:", d, error);
                return null; // Skip this entry if it cannot be processed
            }
        }).filter(d => d !== null); // Remove invalid entries
    }

    async function prefetchAdjacentYears(year) {
        const adjacentYears = [year - 1, year + 1];
        
        for (const adjYear of adjacentYears) {
            if (adjYear >= 2019 && adjYear <= 2022 && !dataCache.has(adjYear) && !loadingQueue.has(adjYear)) {
                loadingQueue.add(adjYear);
                try {
                    const data = await d3.csv(`data/flights_${adjYear}.csv`);
                    dataCache.set(adjYear, processAirportData(data));
                    console.log(`Data for adjacent year ${adjYear} prefetched and cached.`);
                } finally {
                    loadingQueue.delete(adjYear);
                }
            }
        }
        updateCacheStatus();
    }

    const width = 960;
    const height = 600;
    let currentZoom = 1;
    let minPctDelayed = 0;
    let minConnections = 0;

    const zoom = d3.zoom()
        .scaleExtent([1, 8])
        .on("zoom", zoomed);

    const projection = d3.geoAlbersUsa()
        .translate([width / 2, height / 2])
        .scale(1000);

    const path = d3.geoPath().projection(projection);

    const colorScale = d3.scaleLinear()
        .domain([0, 45])
        .range(["blue", "red"]);

    const svg = d3.select("svg")
        .attr("width", width)
        .attr("height", height)
        .call(zoom);

    const g = svg.append("g");

    g.append("rect")
        .attr("class", "ocean")
        .attr("width", width)
        .attr("height", height);

    g.append("g")
        .attr("class", "states")
        .selectAll("path")
        .data(topojson.feature(us, us.objects.states).features)
        .enter().append("path")
        .attr("d", path);

    g.append("path")
        .attr("class", "state-borders")
        .attr("d", path(topojson.mesh(us, us.objects.states, (a, b) => a !== b)));

    const connectionsGroup = g.append("g").attr("class", "connections");
    const airportsGroup = g.append("g").attr("class", "airports");

    const tooltip = d3.select("body").append("div")
        .attr("class", "tooltip")
        .style("opacity", 0);

    const legendWidth = 300, legendHeight = 10;
    const legendSvg = svg.append("g")
        .attr("class", "legend")
        .attr("transform", `translate(${width - legendWidth - 20},${height - 40})`);
    const gradient = legendSvg.append("defs")
        .append("linearGradient")
        .attr("id", "legend-gradient")
        .attr("x1", "0%").attr("y1", "0%")
        .attr("x2", "100%").attr("y2", "0%");
    gradient.append("stop")
        .attr("offset", "0%")
        .attr("stop-color", "blue");
    gradient.append("stop")
        .attr("offset", "100%")
        .attr("stop-color", "red");

    legendSvg.append("rect")
        .attr("width", legendWidth)
        .attr("height", legendHeight)
        .style("fill", "url(#legend-gradient)");
    legendSvg.append("text")
        .attr("class", "legend-title")
        .attr("x", 0)
        .attr("y", -10)
        .text("Percentage of Delayed Flights");
    legendSvg.append("text")
        .attr("x", 0)
        .attr("y", legendHeight + 15)
        .text("0%");
    legendSvg.append("text")
        .attr("x", legendWidth)
        .attr("y", legendHeight + 15)
        .attr("text-anchor", "end")
        .text("100%");

    let debounceTimeout;

    // Histogram Dimensions
    const histogramWidth = 300;
    const histogramHeight = 200;
    const margin = { top: 20, right: 20, bottom: 30, left: 40 };

    // Scales for histograms
    const xScaleDelay = d3.scaleLinear().range([margin.left, histogramWidth - margin.right]);
    const yScaleDelay = d3.scaleLinear().range([histogramHeight - margin.bottom, margin.top]);

    const xScaleAvgDelay = d3.scaleLinear().range([margin.left, histogramWidth - margin.right]);
    const yScaleAvgDelay = d3.scaleLinear().range([histogramHeight - margin.bottom, margin.top]);

    // Axes
    const xAxisDelay = d3.axisBottom(xScaleDelay).ticks(10);
    const yAxisDelay = d3.axisLeft(yScaleDelay);

    const xAxisAvgDelay = d3.axisBottom(xScaleAvgDelay).ticks(10);
    const yAxisAvgDelay = d3.axisLeft(yScaleAvgDelay);

    const delaySvg = d3.select("#histogram-delay")
    .attr("class", "histogram-svg");

    const avgDelaySvg = d3.select("#histogram-average-delay")
    .attr("class", "histogram-svg");

    delaySvg.append("g")
    .attr("class", "x-axis") 
    .attr("transform", `translate(0, ${histogramHeight - margin.bottom})`);

    delaySvg.append("g")
    .attr("class", "y-axis") 
    .attr("transform", `translate(${margin.left}, 0)`);

    avgDelaySvg.append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0, ${histogramHeight - margin.bottom})`);

    avgDelaySvg.append("g")
    .attr("class", "y-axis")
    .attr("transform", `translate(${margin.left}, 0)`);

    



    function clusterAirports(data, projection) {
        const clusters = {}; // Group by state
    
        data.forEach(airport => {
            const state = airport.STATE;
            const coords = projection([airport.LONGITUDE, airport.LATITUDE]);
            if (!coords) return;
    
            // Check if a cluster already exists for this state
            if (!clusters[state]) {
                clusters[state] = {
                    state: state,
                    x: 0,
                    y: 0,
                    airports: new Set(), // Unique airports based on coordinates
                    airlines: new Set(), // Unique airlines
                    connections: new Set(), // Unique destinations
                    total_delayed: 0, // Total delayed flights
                    total_delay_minutes: 0, // Total delay in minutes
                    total_flights: 0, // Total flights in the cluster
                    pct_delayed: 0, // Percentage of delayed flights
                    avg_delay: 0 // Average delay in minutes for delayed flights
                };
            }
    
            const stateCluster = clusters[state];

            if (!stateCluster.sumX) {
                stateCluster.sumX = 0;
                stateCluster.sumY = 0;
            }
    
            // Track unique airports based on coordinates (LATITUDE, LONGITUDE)
            const airportKey = `${airport.LATITUDE},${airport.LONGITUDE}`;
            if (!stateCluster.airports.has(airportKey)) {
                stateCluster.airports.add(airportKey);
            
                // Update the running sums of coordinates
                stateCluster.sumX += coords[0];
                stateCluster.sumY += coords[1];
            
                // Increment the count of unique airports
                stateCluster.airportsCount = stateCluster.airports.size;
            
                // Calculate the new average position
                stateCluster.x = stateCluster.sumX / stateCluster.airportsCount;
                stateCluster.y = stateCluster.sumY / stateCluster.airportsCount;
            }
             // Track unique airlines
        airport.AIRLINE.forEach(airl => stateCluster.airlines.add(airl));
    
            // Track unique destinations from the airport's connections
            airport.connections.forEach(dest => stateCluster.connections.add(dest));
    
            // Update cluster totals
            stateCluster.total_flights += airport.flights;
            stateCluster.total_delayed += airport.delayed;
            stateCluster.total_delay_minutes += airport.avg_delay * airport.delayed; // Avg delay is for delayed flights only
        });
    
        // Convert clusters object to array and compute final metrics
        return Object.values(clusters).map(cluster => {
            // Calculate average delay only for delayed flights
            cluster.avg_delay = cluster.total_delayed > 0
                ? cluster.total_delay_minutes / cluster.total_delayed
                : 0;
    
            // Calculate percentage of delayed flights out of total flights
            cluster.pct_delayed = cluster.total_flights > 0
                ? (cluster.total_delayed / cluster.total_flights) * 100
                : 0;
    
            return {
                code: cluster.state,
                x: cluster.x,
                y: cluster.y,
                count: cluster.airports.size, // Number of unique airports in the cluster
                total_flights: cluster.total_flights,
                total_delayed: cluster.total_delayed,
                avg_delay: cluster.avg_delay, // Average delay in minutes for delayed flights
                pct_delayed: cluster.pct_delayed, // Percentage of delayed flights
                airports: Array.from(cluster.airports), // Unique airports in the cluster
                airlines: Array.from(cluster.airlines), // Unique airlines in the cluster
                connections: Array.from(cluster.connections) // Unique destinations in the cluster
            };
        });
    }

    function aggregateAirportData(airports) {

        const aggregatedData = d3.groups(airports, d => d.ORIGIN) // Group by airport code
            .map(([key, values]) => {
                const totalFlights = d3.sum(values, d => d.flights);
                const totalDelayed = d3.sum(values, d => d.delayed);
    
                return {
                    AIRPORT: values[0].AIRPORT, // Use the airport name (same for all records in the group)
                    LONGITUDE: values[0].LONGITUDE,
                    ORIGIN_CITY: values[0].ORIGIN_CITY,
                    code: values[0].ORIGIN,
                    LATITUDE: values[0].LATITUDE,
                    STATE: values[0].STATE,
                    flights: totalFlights, // Sum the total flights
                    delayed: totalDelayed, // Sum the delayed flights
                    pct_delayed: totalFlights > 0 ? (totalDelayed / totalFlights) * 100 : 0, // Calculate percentage of delayed flights
                    avg_delay: totalDelayed > 0 ? d3.sum(values, d => d.avg_delay * d.delayed) / totalDelayed : 0, // Average delay in minutes
                    AIRLINE: [...new Set(values.flatMap(d => d.AIRLINE))], // Get unique airlines
                    connections: [...new Set(values.flatMap(d => d.connections))], // Get unique destinations
                };
            });
    
        return aggregatedData; // Return the aggregated data
    }
    

    
    
    function zoomed(event) {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
            currentZoom = event.transform.k;
            g.transition()
                .duration(500)
                .attr("transform", event.transform);
            requestAnimationFrame(() => updateAirports());
        }, 100);
    }

    function updateHistograms(data) {
        // Delay Percentage Histogram
        const delayBins = d3.histogram()
            .domain([0, 100])
            .thresholds(10)
            .value(d => d.pct_delayed)(data);
    
        xScaleDelay.domain([0, 100]);
        yScaleDelay.domain([0, d3.max(delayBins, d => d.length)]);
    
        delaySvg.select(".x-axis").call(xAxisDelay);
        delaySvg.select(".y-axis").call(yAxisDelay);
    
        const bars = delaySvg.selectAll(".bar")
            .data(delayBins, d => d.x0);
    
        bars.exit()
            .transition().duration(300)
            .attr("height", 0)
            .remove();
    
        const barsEnter = bars.enter().append("rect").attr("class", "bar")
            .attr("x", d => xScaleDelay(d.x0) + 1)
            .attr("width", d => Math.max(0, xScaleDelay(d.x1) - xScaleDelay(d.x0) - 1))
            .attr("y", histogramHeight - margin.bottom)
            .attr("height", 0);
    
        barsEnter.merge(bars)
            .transition().duration(300)
            .attr("x", d => xScaleDelay(d.x0) + 1)
            .attr("width", d => Math.max(0, xScaleDelay(d.x1) - xScaleDelay(d.x0) - 1))
            .attr("y", d => yScaleDelay(d.length))
            .attr("height", d => histogramHeight - margin.bottom - yScaleDelay(d.length));
    
        // Average Delay Histogram
        const avgDelayBins = d3.histogram()
            .domain([0, 120])
            .thresholds(10)
            .value(d => d.avg_delay)(data);
    
        xScaleAvgDelay.domain([0, 120]);
        yScaleAvgDelay.domain([0, d3.max(avgDelayBins, d => d.length)]);
    
        avgDelaySvg.select(".x-axis").call(xAxisAvgDelay);
        avgDelaySvg.select(".y-axis").call(yAxisAvgDelay);
    
        const avgBars = avgDelaySvg.selectAll(".bar")
            .data(avgDelayBins, d => d.x0);
    
        avgBars.exit()
            .transition().duration(300)
            .attr("height", 0)
            .remove();
    
        const avgBarsEnter = avgBars.enter().append("rect").attr("class", "bar")
            .attr("x", d => xScaleAvgDelay(d.x0) + 1)
            .attr("width", d => Math.max(0, xScaleAvgDelay(d.x1) - xScaleAvgDelay(d.x0) - 1))
            .attr("y", histogramHeight - margin.bottom)
            .attr("height", 0);
    
        avgBarsEnter.merge(avgBars)
            .transition().duration(300)
            .attr("x", d => xScaleAvgDelay(d.x0) + 1)
            .attr("width", d => Math.max(0, xScaleAvgDelay(d.x1) - xScaleAvgDelay(d.x0) - 1))
            .attr("y", d => yScaleAvgDelay(d.length))
            .attr("height", d => histogramHeight - margin.bottom - yScaleAvgDelay(d.length));
    }
    
    

    function updateAirports() {
        const [[x0, y0], [x1, y1]] = path.bounds(topojson.feature(us, us.objects.states));
        currentViewport = {x0, y0, x1, y1};

        const filteredAirports = airports.filter(d => {
            // Filter by visible area in the viewport
            const coords = projection([d.LONGITUDE, d.LATITUDE]);
            return coords && 
                   coords[0] >= x0 && coords[0] <= x1 &&
                   coords[1] >= y0 && coords[1] <= y1 &&
                   d.pct_delayed >= minPctDelayed && 
                   d.connections.length >= minConnections;
        });
    
        // Perform aggregation on the filtered data
        const displayAirports = aggregateAirportData(filteredAirports);


        // Update display count
        updateVisibleAirportsCount(displayAirports.length, displayAirports.length);

            // Existing clustering and rendering code
            const clusterRadius = currentZoom >= 2 ? 0 : 40 / currentZoom;
            const clusters = clusterRadius > 0 ? 
                clusterAirports(displayAirports, projection):
                displayAirports.map(d => ({
                    code: d.code,
                    x: projection([d.LONGITUDE, d.LATITUDE])[0],
                    y: projection([d.LONGITUDE, d.LATITUDE])[1],
                    count: 1,
                    airport: d.AIRPORT,
                    flights: d.flights,
                    delayed: d.delayed,
                    avg_delay: d.avg_delay,
                    pct_delayed: d.pct_delayed,
                    airline: d.AIRLINE,
                    connections: d.connections,
                    city: d.ORIGIN_CITY
                }));
        
        
        
        updateHistograms(displayAirports); 


        
        console.log(clusters); // Log the clusters data to the console
                
        const clusterMarkers = airportsGroup.selectAll("circle")
            .data(clusters, d => d.code);

        clusterMarkers.exit()
            .transition()
            .duration(300)
            .attr("r", 0)
            .remove();


        const markersEnter = clusterMarkers.enter()
        .append("circle")
        .attr("class", "airport")
        .attr("r", 0)
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .attr("fill", d => colorScale(d.pct_delayed))
        .on("mouseover", function(event, d) {
            tooltip.transition().duration(200).style("opacity", .9);

            let tooltipHtml = "";
            if (d.count != 1) {
                // Clustered airports: Show info about the cluster
                tooltipHtml = `
                <div style="font-family: Arial, sans-serif; line-height: 1.4; color: #333;">
                    <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px;">
                        Cluster of ${d.count} airports
                    </div>
                    <div style="font-size: 12px;">
                        <strong>State:</strong> ${d.code}<br>
                        <strong>Total Flights:</strong> ${d.total_flights}<br>
                        <strong>Total Delayed Flights:</strong> ${d.total_delayed}<br>
                        <strong>% of Flights Delayed:</strong> ${d3.format(".1f")(d.pct_delayed)}%<br>
                        <strong>Average Delay (minutes):</strong> ${d3.format(".1f")(d.avg_delay)} min<br>
                        <strong>Unique Airlines:</strong> ${d.airlines.length}<br>
                        <strong>Unique Destinations:</strong> ${d.connections.length}<br>
                    </div>
                </div>
            `;
        } else {
            // Single airport: Show info about the individual airport
            tooltipHtml = `
                <div style="font-family: Arial, sans-serif; line-height: 1.4; color: #333;">
                    <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px;">
                        ${d.airport} (${d.code})
                    </div>
                    <div style="font-size: 12px;">
                        <strong>City:</strong> ${d.city}<br>
                        <strong>Total Flights:</strong> ${d.flights}<br>
                        <strong>Total Delayed Flights:</strong> ${d.delayed}<br>
                        <strong>% of Flights Delayed:</strong> ${d3.format(".1f")(d.pct_delayed)}%<br>
                        <strong>Average Delay (minutes):</strong> ${d3.format(".1f")(d.avg_delay)} min<br>
                        <strong>Unique Airlines:</strong> ${d.airline.length}<br>
                        <strong>Unique Destinations:</strong> ${d.connections.length}<br>
                    </div>
                </div>
            `;
        }

        tooltip.html(tooltipHtml)
            .style("left", (event.pageX + 10) + "px")
            .style("top", (event.pageY - 28) + "px");
    })
    .on("mouseout", function() {
        tooltip.transition().duration(500).style("opacity", 0);
    })
    .on("click", function(event, d) {
        if (d.count > 1) {
            console.log(`Clicked on cluster with ${d.count} airports:`, d.airports.map(a => a.code));
        } else {
            console.log(`Clicked on single airport: ${d.code}`);
            toggleConnections(d);
        }
    });



        // In updateAirports() function, modify these lines:
        markersEnter.transition()
            .duration(500)
            .attr("r", d => Math.max(2 / currentZoom, Math.min(3 + (d.count - 1), 16 / currentZoom)));

        clusterMarkers.merge(markersEnter)
            .transition()
            .duration(300)
            .attr("cx", d => d.x)
            .attr("cy", d => d.y)
            .attr("r", d => Math.max(2 / currentZoom, Math.min(3 + (d.count - 1), 16 / currentZoom)))
            .attr("fill", d => colorScale(d.pct_delayed));
     }

     function toggleConnections(selectedAirport) {
        console.log(`Toggling connections for airport: ${selectedAirport.code}`);
        console.log(`Connections: ${selectedAirport.connections}`);
    
        // Select existing connections for the current airport
        const existingConnections = connectionsGroup.selectAll("path.connection")
            .filter(function() {
                return d3.select(this).attr("origin") === selectedAirport.code;
            });
    
        // If connections already exist, remove them
        if (!existingConnections.empty()) {
            existingConnections.transition()
                .duration(500)
                .attr("stroke-width", 0)
                .style("opacity", 0)
                .remove();
            console.log(`Removed connections for airport: ${selectedAirport.code}`);
            return;
        }
    
        // Perform aggregation on the filtered data
        const AGGairports = aggregateAirportData(airports);

        console.log(AGGairports)


        // Draw new connections
        selectedAirport.connections.forEach(destCode => {
            // Find destination airport in the clustered/aggregated data
            const destAirport = AGGairports.find(a => a.code === destCode);
            
            if (destAirport) {
                // Calculate coordinates for the origin and destination airports
                const originCoords = [selectedAirport.x, selectedAirport.y]
                const destCoords = projection([destAirport.LONGITUDE, destAirport.LATITUDE]);

                
                
                if (originCoords && destCoords) {
                    connectionsGroup.append("path")
                        .attr("class", "connection")
                        .attr("d", `M${originCoords[0]},${originCoords[1]}
                                    L${originCoords[0]},${originCoords[1]}`) // Start as a point
                        .attr("stroke", "orange")
                        .attr("stroke-width", 2)
                        .attr("fill", "none")
                        .attr("origin", selectedAirport.code)
                        .attr("destination", destAirport.code)
                        .transition()
                        .duration(1000)
                        .attr("d", `M${originCoords[0]},${originCoords[1]}
                                    L${destCoords[0]},${destCoords[1]}`) // Animate to a line
                        .style("opacity", 0.8);
                } else {
                    console.warn(`Invalid coordinates for connection from ${selectedAirport.code} to ${destAirport.code}`);
                }
            } else {
                console.warn(`Destination airport not found for code: ${destCode}`);
            }
        });
    }
    

    function initializeVisualization() {
        updateAirports();

        // Zoom controls
        d3.select("#zoom-in").on("click", () => {
            svg.transition()
                .duration(750)
                .call(zoom.scaleBy, 2);
        });
        d3.select("#zoom-out").on("click", () => {
            svg.transition()
                .duration(750)
                .call(zoom.scaleBy, 0.5);
        });
        d3.select("#reset").on("click", () => {
            svg.transition()
                .duration(750)
                .call(zoom.transform, d3.zoomIdentity);
        });

        // Filter controls
        d3.select("#apply-filters").on("click", () => {
            minPctDelayed = +d3.select("#pct-delayed").property("value");
            minConnections = +d3.select("#num-connections").property("value");
            updateAirports();
        });

        // Year filter control
        d3.select("#year-select").on("change", function() {
            currentYear = this.value;
            loadData(currentYear).then(() => {
                updateAirports();
            });
        });
    }

    // Status update functions
    function updateLoadingStatus(isLoading) {
        d3.select("#loading-indicator")
            .style("display", isLoading ? "block" : "none");
    }

    function updateCacheStatus() {
        d3.select("#cache-status")
            .text(`Cached years: ${Array.from(dataCache.keys()).join(", ")}`);
    }

    function updateVisibleAirportsCount(displayed, total) {
        d3.select("#visible-airports")
            .text(`Showing ${displayed} of ${total} airports in view`);
    }

    // Initialize
    loadData(currentYear).then(() => {
        initializeVisualization();
    });

}).catch(error => {
    console.error("Error loading the data:", error);
});
