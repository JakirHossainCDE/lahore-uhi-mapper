document.addEventListener('DOMContentLoaded', () => {
    // Initialize map centered on Lahore
    const map = L.map('map').setView([31.5497, 74.3436], 12);
    
    let uhiLayer = null;
    let mitigationLayer = null;

    // Define base map layers
    const baseLayers = {
        "Street Map": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }),
        "Satellite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri'
        }),
        "Topographical": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
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
        defaultMarkGeocode: false
    })
    .on('markgeocode', function(e) {
        map.fitBounds(e.geocode.bbox);
    })
    .addTo(map);

    // Base map selector
    document.getElementById('base-map').addEventListener('change', function() {
        const selectedMap = this.value;
        Object.values(baseLayers).forEach(layer => map.removeLayer(layer));
        
        switch(selectedMap) {
            case 'satellite':
                baseLayers["Satellite"].addTo(map);
                break;
            case 'topo':
                baseLayers["Topographical"].addTo(map);
                break;
            case 'hybrid':
                baseLayers["Hybrid"].addTo(map);
                break;
            default:
                baseLayers["Street Map"].addTo(map);
        }
    });

    // Set default dates
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(endDate.getMonth() - 1);
    
    document.getElementById('start-date').valueAsDate = startDate;
    document.getElementById('end-date').valueAsDate = endDate;

    // Load UHI data
    document.getElementById('load-data').addEventListener('click', async () => {
        const startDate = document.getElementById('start-date').value;
        const endDate = document.getElementById('end-date').value;
        
        try {
            // Updated fetch URL to point to the FastAPI server
            const response = await fetch(`http://localhost:8000/uhi-data?start_date=${startDate}&end_date=${endDate}`);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Failed to fetch UHI data');
            }
            const data = await response.json();
            
            // Clear existing layers
            if (uhiLayer) map.removeLayer(uhiLayer);
            
            // Add new UHI layer
            uhiLayer = L.geoJSON(data, {
                style: feature => ({
                    fillColor: getTemperatureColor(feature.properties.lst),
                    weight: 0,
                    opacity: 0,
                    fillOpacity: 0.7
                })
            }).addTo(map);
            
            alert("UHI data loaded successfully!");
            
        } catch (error) {
            console.error("Error loading UHI data:", error);
            alert("Failed to load UHI data. " + error.message);
        }
    });

    // Show mitigation areas
    document.getElementById('show-mitigation').addEventListener('click', async () => {
        try {
            // Updated fetch URL to point to the FastAPI server
            const response = await fetch('http://localhost:8000/mitigation-suggestions');
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Failed to fetch mitigation suggestions');
            }
            const data = await response.json();
            
            // Clear existing layers
            if (mitigationLayer) map.removeLayer(mitigationLayer);
            
            // Add mitigation suggestions
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
                        Suggestion: ${feature.properties.suggestion}<br>
                        Priority: ${feature.properties.priority}
                    `);
                }
            }).addTo(map);

            alert("Mitigation suggestions loaded successfully!");
            
        } catch (error) {
            console.error("Error loading mitigation data:", error);
            alert("Failed to load mitigation suggestions. " + error.message);
        }
    });

    // Helper function to get color based on temperature
    function getTemperatureColor(temp) {
        if (temp > 40) return '#d7191c';
        if (temp > 35) return '#fdae61';
        if (temp > 30) return '#ffffbf';
        if (temp > 25) return '#abdda4';
        return '#2b83ba';
    }
});
