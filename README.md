# 🌡️ Lahore Urban Heat Island (UHI) Mapper

![App Screenshot]

A web-based geospatial tool for analyzing urban heat patterns in Lahore using satellite data and Google Earth Engine.

## 🚀 Features

### 🌐 Interactive Mapping
- Multiple base map layers (Street, Satellite, Topographical, Hybrid)
- Zoom and pan functionality
- Location search using geocoding

### 🔥 Heat Analysis
- Land Surface Temperature (LST) visualization
- Urban Heat Island (UHI) intensity calculation
- Custom date range selection
- Temperature legend with color gradient

### 🌿 Mitigation Planning
- Hotspot identification
- Suggested greening areas
- Priority classification for mitigation

## 🛠️ Technologies

### Frontend
| Technology | Purpose |
|------------|---------|
| Leaflet.js | Interactive maps |
| HTML5/CSS3 | User interface |
| JavaScript | Application logic |

### Backend
| Technology | Purpose |
|------------|---------|
| FastAPI | REST API server |
| Google Earth Engine | Satellite data processing |
| Geemap | Earth Engine to GeoJSON conversion |

## 💻 Installation

### Prerequisites
- Python 3.8+
- Google Earth Engine account
- Node.js (optional for development)

```bash
# Clone the repository
git clone https://github.com/JakirHossainCDE/lahore-uhi-mapper.git

cd lahore-uhi-mapper

# Set up Python environment
python -m venv venv
source venv/bin/activate  # Linux/Mac
venv\Scripts\activate    # Windows

# Install dependencies
pip install -r requirements.txt

# Authenticate Earth Engine
earthengine authenticate

# Run the application
uvicorn uhi_api:app --reload
