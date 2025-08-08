document.addEventListener('DOMContentLoaded', () => {
    // Initialize map centered on Lahore with better default view
    const map = L.map('map', {
        zoomControl: false,
        preferCanvas: true  // Better for large datasets
    }).setView([31.5497, 74.3436], 12);
    
    // Add zoom control with better position
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Layer references
    let uhiLayer = null;
    let mitigationLayer = null;
    let legend = null;
    let currentDateRange = null;

    // Base map layers with better attribution control
    const baseLayers = {
        "Street Map": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19
        }),
        "Satellite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
            maxZoom: 19
        }),
        "Topographical": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 17
        }),
        "Hybrid": L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
            subdomains: ['mt0','mt1','mt2','mt3'],
            attribution: '&copy; Google Maps',
            maxZoom: 20
        })
    };

    // Add default base map
    baseLayers["Street Map"].addTo(map);

    // Improved geocoder control
    const geocoder = L.Control.geocoder({
        defaultMarkGeocode: false,
        position: 'topright',
        placeholder: 'Search in Lahore...',
        errorMessage: 'Location not found.',
        bounds: L.latLngBounds([31.3000, 74.1472], [31.6920, 74.5500]),  // Lahore bounds
        collapsed: false
    }).on('markgeocode', function(e) {
        map.fitBounds(e.geocode.bbox, { padding: [50, 50] });
    }).addTo(map);

    // Base map selector with localStorage persistence
    const baseMapSelect = document.getElementById('base-map');
    const savedBaseMap = localStorage.getItem('selectedBaseMap') || 'street';
    baseMapSelect.value = savedBaseMap;
    
    baseMapSelect.addEventListener('change', function() {
        const selectedMap = this.value;
        localStorage.setItem('selectedBaseMap', selectedMap);
        Object.values(baseLayers).forEach(layer => map.removeLayer(layer));
        baseLayers[selectedMap === 'satellite' ? "Satellite" :
                  selectedMap === 'topo' ? "Topographical" :
                  selectedMap === 'hybrid' ? "Hybrid" : "Street Map"].addTo(map);
    });

    // Set default dates (last 30 days) with better formatting
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 30);  // More precise than setMonth
    
    document.getElementById('start-date').valueAsDate = startDate;
    document.getElementById('end-date').valueAsDate = endDate;
    currentDateRange = {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
    };

    // Date validation
    function validateDates() {
        const start = new Date(document.getElementById('start-date').value);
        const end = new Date(document.getElementById('end-date').value);
        
        if (start > end) {
            alert('End date must be after start date');
            return false;
        }
        
        const maxDays = 365;  // 1 year maximum
        if ((end - start) / (1000 * 60 * 60 * 24) > maxDays) {
            alert(`Date range cannot exceed ${maxDays} days`);
            return false;
        }
        
        return true;
    }

    // Improved UHI data loading with progress indication
    document.getElementById('load-data').addEventListener('click', async () => {
        if (!validateDates()) return;
        
        const startDate = document.getElementById('start-date').value;
        const endDate = document.getElementById('end-date').value;
        
        // Skip if same date range
        if (currentDateRange && 
            currentDateRange.start === startDate && 
            currentDateRange.end === endDate) {
            return;
        }
        
        currentDateRange = { start: startDate, end: endDate };
        
        try {
            // Show loading state
            const loadBtn = document.getElementById('load-data');
            loadBtn.disabled = true;
            loadBtn.innerHTML = '<span class="spinner"></span> Loading...';
            
            // Show loading indicator on map
            const loadingControl = L.control({ position: 'topleft' });
            loadingControl.onAdd = () => {
                const div = L.DomUtil.create('div', 'loading-indicator');
                div.innerHTML = 'Loading UHI data...';
                return div;
            };
            loadingControl.addTo(map);
            
            const response = await fetch(`/uhi-data?start_date=${startDate}&end_date=${endDate}`);
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to fetch UHI data');
            }

            const data = await response.json();
            
            // Remove existing layers
            if (uhiLayer) map.removeLayer(uhiLayer);
            if (legend) map.removeControl(legend);
            map.removeControl(loadingControl);
            
            // Process and visualize UHI data with better performance
            uhiLayer = L.geoJSON(data, {
                style: feature => {
                    const lstValue = feature.properties?.LST || 25;
                    return {
                        fillColor: getTemperatureColor(lstValue),
                        weight: 0,
                        opacity: 0,
                        fillOpacity: 0.7,
                        interactive: true
                    };
                },
                onEachFeature: (feature, layer) => {
                    if (feature.properties?.LST) {
                        layer.bindPopup(`
                            <div class="popup-content">
                                <h4>Temperature Information</h4>
                                <p><strong>LST:</strong> ${feature.properties.LST.toFixed(2)}°C</p>
                                <p><strong>Date Range:</strong> ${feature.properties.start_date} to ${feature.properties.end_date}</p>
                                ${feature.properties.NDVI ? `<p><strong>Vegetation Index (NDVI):</strong> ${feature.properties.NDVI.toFixed(2)}</p>` : ''}
                                ${feature.properties.UHI ? `<p><strong>UHI Intensity:</strong> ${feature.properties.UHI.toFixed(2)}°C</p>` : ''}
                            </div>
                        `, { maxWidth: 300 });
                    }
                }
            }).addTo(map);
            
            // Fit bounds to data
            if (data.features && data.features.length > 0) {
                map.fitBounds(uhiLayer.getBounds(), { padding: [50, 50] });
            }
            
            // Improved legend with dynamic values
            legend = L.control({ position: 'bottomright' });
            legend.onAdd = () => {
                const div = L.DomUtil.create('div', 'info legend');
                div.innerHTML = `
                    <h4>Land Surface Temperature (°C)</h4>
                    <div class="legend-gradient"></div>
                    <div class="legend-labels">
                        <span>25</span>
                        <span>30</span>
                        <span>35</span>
                        <span>40+</span>
                    </div>
                    <div class="legend-date">${startDate} to ${endDate}</div>
                `;
                return div;
            };
            legend.addTo(map);
            
        } catch (error) {
            console.error("Error loading UHI data:", error);
            showAlert(`Error: ${error.message}`, 'error');
        } finally {
            const loadBtn = document.getElementById('load-data');
            loadBtn.disabled = false;
            loadBtn.textContent = "Load UHI Data";
        }
    });

    // Enhanced mitigation areas with clustering
    document.getElementById('show-mitigation').addEventListener('click', async () => {
        try {
            // Show loading state
            const mitBtn = document.getElementById('show-mitigation');
            mitBtn.disabled = true;
            mitBtn.innerHTML = '<span class="spinner"></span> Loading...';
            
            const response = await fetch('/mitigation-suggestions');
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to fetch mitigation data');
            }

            const data = await response.json();
            
            // Remove existing layer
            if (mitigationLayer) map.removeLayer(mitigationLayer);
            
            // Create marker cluster group for better performance
            const markers = L.markerClusterGroup({
                spiderfyOnMaxZoom: true,
                showCoverageOnHover: false,
                zoomToBoundsOnClick: true,
                maxClusterRadius: 40
            });
            
            // Process and visualize mitigation data
            mitigationLayer = L.geoJSON(data, {
                pointToLayer: (feature, latlng) => {
                    const priority = feature.properties.priority || 'high';
                    const colors = {
                        high: '#e74c3c',
                        medium: '#f39c12',
                        low: '#2ecc71'
                    };
                    
                    return L.circleMarker(latlng, {
                        radius: 6,
                        fillColor: colors[priority] || '#27ae60',
                        color: '#fff',
                        weight: 1,
                        fillOpacity: 0.8
                    });
                },
                onEachFeature: (feature, layer) => {
                    layer.bindPopup(`
                        <div class="popup-content">
                            <h4>Mitigation Suggestion</h4>
                            <p><strong>Type:</strong> ${feature.properties.suggestion || 'urban_greening'}</p>
                            <p><strong>Priority:</strong> <span class="priority-${feature.properties.priority || 'high'}">${feature.properties.priority || 'high'}</span></p>
                            <p><strong>UHI Threshold:</strong> ${feature.properties.threshold || 2.0}°C</p>
                            <p><strong>Estimated Cooling:</strong> ${feature.properties.estimated_cooling || '2-5°C'}</p>
                        </div>
                    `, { maxWidth: 300 });
                }
            });
            
            markers.addLayer(mitigationLayer);
            map.addLayer(markers);
            
            // Fit bounds to data if not too large
            if (data.features && data.features.length < 1000) {
                map.fitBounds(markers.getBounds(), { padding: [50, 50] });
            }
            
        } catch (error) {
            console.error("Error loading mitigation data:", error);
            showAlert(`Error: ${error.message}`, 'error');
        } finally {
            const mitBtn = document.getElementById('show-mitigation');
            mitBtn.disabled = false;
            mitBtn.textContent = "Show Mitigation Areas";
        }
    });

    // Enhanced temperature color scale
    function getTemperatureColor(temp) {
        if (temp > 40) return '#d73027';  // Extreme heat (dark red)
        if (temp > 37) return '#f46d43';  // Very high heat
        if (temp > 35) return '#fdae61';  // High heat (orange)
        if (temp > 32) return '#fee08b';  // Moderate heat (yellow)
        if (temp > 30) return '#ffffbf';  // Warm
        if (temp > 27) return '#d9ef8b';  // Mild
        if (temp > 25) return '#a6d96a';  // Cool (light green)
        if (temp > 22) return '#66bd63';  // Cooler
        if (temp > 20) return '#1a9850';  // Cool (green)
        return '#2b83ba';                // Cold (blue)
    }

    // Better error handling
    function showAlert(message, type = 'info') {
        const alert = L.control({ position: 'topcenter' });
        alert.onAdd = () => {
            const div = L.DomUtil.create('div', `alert alert-${type}`);
            div.innerHTML = message;
            setTimeout(() => {
                alert.remove();
            }, 5000);
            return div;
        };
        alert.addTo(map);
    }

    // Handle map errors
    map.on('error', (e) => {
        console.error("Map error:", e.message);
        showAlert('Map error occurred. Please try again.', 'error');
    });

    // Add scale control
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
});
