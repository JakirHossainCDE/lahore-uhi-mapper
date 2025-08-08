document.addEventListener('DOMContentLoaded', () => {
    // Initialize map centered on Lahore
    const map = L.map('map').setView([31.5497, 74.3436], 12);
    
    // Layer references
    let uhiLayer = null;
    let mitigationLayer = null;
    let legend = null;

    // Base map layers
    const baseLayers = {
        "Street Map": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }),
        "Satellite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri'
        }),
        "Topographical": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }),
        "Hybrid": L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
            subdomains: ['mt0','mt1','mt2','mt3'],
            attribution: '&copy; Google Maps'
        })
    };

    // Add default base map
    baseLayers["Street Map"].addTo(map);

    // Add geocoder control
    L.Control.geocoder({
        defaultMarkGeocode: false,
        position: 'topright',
        placeholder: 'Search location...',
        errorMessage: 'Location not found.'
    }).on('markgeocode', function(e) {
        map.fitBounds(e.geocode.bbox);
    }).addTo(map);

    // Base map selector
    document.getElementById('base-map').addEventListener('change', function() {
        const selectedMap = this.value;
        Object.values(baseLayers).forEach(layer => map.removeLayer(layer));
        baseLayers[selectedMap === 'satellite' ? "Satellite" :
                  selectedMap === 'topo' ? "Topographical" :
                  selectedMap === 'hybrid' ? "Hybrid" : "Street Map"].addTo(map);
    });

    // Set default dates (last 30 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(endDate.getMonth() - 1);
    
    document.getElementById('start-date').valueAsDate = startDate;
    document.getElementById('end-date').valueAsDate = endDate;

    // Load UHI Data
    document.getElementById('load-data').addEventListener('click', async () => {
        const startDate = document.getElementById('start-date').value;
        const endDate = document.getElementById('end-date').value;
        
        try {
            // Show loading state
            const loadBtn = document.getElementById('load-data');
            loadBtn.disabled = true;
            loadBtn.textContent = "Loading...";
            
            const response = await fetch(`http://localhost:8000/uhi-data?start_date=${startDate}&end_date=${endDate}`);
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to fetch UHI data');
            }

            const data = await response.json();
            
            // Remove existing layers
            if (uhiLayer) map.removeLayer(uhiLayer);
            if (legend) map.removeControl(legend);
            
            // Process and visualize UHI data
            uhiLayer = L.geoJSON(data, {
                style: feature => {
                    // Use LST value from properties or default to 25°C
                    const lstValue = feature.properties?.LST || 25;
                    return {
                        fillColor: getTemperatureColor(lstValue),
                        weight: 0.5,
                        opacity: 1,
                        color: 'white',
                        fillOpacity: 0.7
                    };
                },
                onEachFeature: (feature, layer) => {
                    // Add popup with temperature info
                    if (feature.properties?.LST) {
                        layer.bindPopup(`
                            <b>Temperature Information</b><br>
                            LST: ${feature.properties.LST.toFixed(2)}°C<br>
                            Date Range: ${feature.properties.start_date} to ${feature.properties.end_date}
                        `);
                    }
                }
            }).addTo(map);
            
            // Add legend
            legend = L.control({position: 'bottomright'});
            legend.onAdd = function() {
                const div = L.DomUtil.create('div', 'info legend');
                div.innerHTML = `
                    <h4>Temperature (°C)</h4>
                    <div class="legend-gradient"></div>
                    <div class="legend-labels">
                        <span>25</span>
                        <span>30</span>
                        <span>35</span>
                        <span>40+</span>
                    </div>
                `;
                return div;
            };
            legend.addTo(map);
            
        } catch (error) {
            console.error("Error loading UHI data:", error);
            alert(`Error: ${error.message}`);
        } finally {
            // Reset button state
            const loadBtn = document.getElementById('load-data');
            loadBtn.disabled = false;
            loadBtn.textContent = "Load UHI Data";
        }
    });

    // Show Mitigation Areas
    document.getElementById('show-mitigation').addEventListener('click', async () => {
        try {
            // Show loading state
            const mitBtn = document.getElementById('show-mitigation');
            mitBtn.disabled = true;
            mitBtn.textContent = "Loading...";
            
            const response = await fetch('http://localhost:8000/mitigation-suggestions');
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to fetch mitigation data');
            }

            const data = await response.json();
            
            // Remove existing layer
            if (mitigationLayer) map.removeLayer(mitigationLayer);
            
            // Process and visualize mitigation data
            mitigationLayer = L.geoJSON(data, {
                pointToLayer: (feature, latlng) => {
                    return L.circleMarker(latlng, {
                        radius: 8,
                        fillColor: "#27ae60",
                        color: "#fff",
                        weight: 1,
                        fillOpacity: 0.8
                    }).bindPopup(`
                        <b>Mitigation Suggestion</b><br>
                        Type: ${feature.properties.suggestion || 'urban_greening'}<br>
                        Priority: ${feature.properties.priority || 'high'}<br>
                        UHI Threshold: ${feature.properties.threshold || 2.0}°C
                    `);
                }
            }).addTo(map);
            
        } catch (error) {
            console.error("Error loading mitigation data:", error);
            alert(`Error: ${error.message}`);
        } finally {
            // Reset button state
            const mitBtn = document.getElementById('show-mitigation');
            mitBtn.disabled = false;
            mitBtn.textContent = "Show Mitigation Areas";
        }
    });

    // Temperature color scale
    function getTemperatureColor(temp) {
        if (temp > 40) return '#d7191c';  // Extreme heat (red)
        if (temp > 35) return '#fdae61';  // High heat (orange)
        if (temp > 30) return '#ffffbf';  // Moderate heat (yellow)
        if (temp > 25) return '#abdda4';  // Mild (light green)
        return '#2b83ba';                 // Cool (blue)
    }

    // Add some basic error handling for the map
    map.on('error', (e) => {
        console.error("Map error:", e.message);
    });
});
