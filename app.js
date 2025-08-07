document.addEventListener('DOMContentLoaded', () => {
    // Initialize map centered on Lahore
    const map = L.map('map').setView([31.5497, 74.3436], 12);
    
    // Define base map layers
    const baseLayers = {
        "Street Map": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }),
        "Satellite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
        }),
        "Topographical": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
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
            const response = await fetch(`/uhi-data?start_date=${startDate}&end_date=${endDate}`);
            const data = await response.json();
            
            // Clear existing layers
            if (window.uhiLayer) map.removeLayer(window.uhiLayer);
            
            // Add new UHI layer
            window.uhiLayer = L.geoJSON(data, {
                style: feature => ({
                    fillColor: getTemperatureColor(feature.properties.lst),
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.7
                })
            }).addTo(map);
            
        } catch (error) {
            console.error("Error loading UHI data:", error);
            alert("Failed to load UHI data");
        }
    });

    // Show mitigation areas
    document.getElementById('show-mitigation').addEventListener('click', async () => {
        try {
            const response = await fetch('/mitigation-suggestions');
            const data = await response.json();
            
            // Clear existing layers
            if (window.mitigationLayer) map.removeLayer(window.mitigationLayer);
            
            // Add mitigation suggestions
            window.mitigationLayer = L.geoJSON(data, {
                pointToLayer: (feature, latlng) => {
                    return L.circleMarker(latlng, {
                        radius: 8,
                        fillColor: "#27ae60",
                        color: "#fff",
                        weight: 1,
                        fillOpacity: 0.8
                    }).bindPopup(`
                        <b>Mitigation Suggestion</b><br>
                        ${feature.properties.suggestion}<br>
                        Estimated cooling: ${feature.properties.estimated_cooling}°C
                    `);
                }
            }).addTo(map);
            
        } catch (error) {
            console.error("Error loading mitigation data:", error);
            alert("Failed to load mitigation suggestions");
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