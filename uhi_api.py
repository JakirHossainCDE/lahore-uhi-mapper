from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import ee
import geemap
import json
import logging
from datetime import datetime, timedelta

# Initialize logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Google Earth Engine
try:
    ee.Initialize()
    logger.info("Earth Engine initialized successfully")
except Exception as e:
    logger.error("Earth Engine initialization failed: %s", str(e))
    raise RuntimeError("Please authenticate Earth Engine first: Run 'earthengine authenticate'")

app = FastAPI(title="Lahore UHI Mapper API with GEE")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lahore bounding coordinates [min_lon, min_lat, max_lon, max_lat]
LAHORE_BOUNDS = ee.Geometry.Rectangle([74.1472, 31.3000, 74.5500, 31.6920])

def get_modis_lst(start_date: str, end_date: str):
    """Get MODIS Land Surface Temperature data in Celsius"""
    modis = ee.ImageCollection('MODIS/006/MOD11A1') \
        .filterBounds(LAHORE_BOUNDS) \
        .filterDate(start_date, end_date) \
        .select('LST_Day_1km')
    
    # Convert Kelvin to Celsius and scale properly
    def convert_temp(img):
        return img.multiply(0.02).subtract(273.15).rename('LST')
    
    return modis.map(convert_temp).mean().clip(LAHORE_BOUNDS)

def get_sentinel_ndvi(start_date: str, end_date: str, cloud_cover: int = 10):
    """Calculate NDVI from Sentinel-2"""
    sentinel = ee.ImageCollection('COPERNICUS/S2_SR') \
        .filterBounds(LAHORE_BOUNDS) \
        .filterDate(start_date, end_date) \
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloud_cover))
    
    def calculate_ndvi(img):
        ndvi = img.normalizedDifference(['B8', 'B4']).rename('NDVI')
        return ndvi
    
    return sentinel.map(calculate_ndvi).mean().clip(LAHORE_BOUNDS)

def calculate_uhi(lst_image):
    """Calculate Urban Heat Island intensity"""
    rural_mean = lst_image.reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=LAHORE_BOUNDS,
        scale=1000,
        bestEffort=True
    ).get('LST')
    
    return lst_image.subtract(ee.Image.constant(rural_mean)).rename('UHI')

@app.get("/uhi-data")
async def get_uhi_data(
    start_date: str = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d"),
    end_date: str = datetime.now().strftime("%Y-%m-%d")
):
    """Get UHI data from Google Earth Engine"""
    try:
        logger.info(f"Fetching UHI data from {start_date} to {end_date}")
        
        # Get LST and NDVI data
        lst_image = get_modis_lst(start_date, end_date)
        ndvi_image = get_sentinel_ndvi(start_date, end_date)
        
        # Calculate UHI
        uhi_image = calculate_uhi(lst_image)
        
        # Create composite image
        composite = ee.Image.cat([lst_image, ndvi_image, uhi_image])
        
        # Convert to GeoJSON
        geojson = geemap.ee_to_geojson(
            composite,
            LAHORE_BOUNDS,
            scale=500  # 500m resolution
        )
        
        return {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {
                    "start_date": start_date,
                    "end_date": end_date,
                    "data_source": "MODIS/Sentinel-2",
                    "resolution": "500m"
                },
                "geometry": geojson
            }]
        }
        
    except Exception as e:
        logger.error(f"Error processing UHI data: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/mitigation-suggestions")
async def get_mitigation_suggestions(
    threshold: float = 2.0,  # Minimum UHI intensity in °C
    days: int = 30  # Analysis period in days
):
    """Get areas needing mitigation based on UHI intensity"""
    try:
        end_date = datetime.now().strftime("%Y-%m-%d")
        start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        
        logger.info(f"Calculating mitigation areas with threshold {threshold}°C")
        
        # Get UHI and NDVI data
        lst_image = get_modis_lst(start_date, end_date)
        ndvi_image = get_sentinel_ndvi(start_date, end_date)
        uhi_image = calculate_uhi(lst_image)
        
        # Identify hotspots (UHI > threshold AND NDVI < 0.2)
        hotspots = uhi_image.gt(threshold).And(ndvi_image.lt(0.2)).selfMask()
        
        # Convert to vectors
        vectors = hotspots.reduceToVectors(
            geometry=LAHORE_BOUNDS,
            scale=500,
            geometryType='polygon',
            eightConnected=False,
            labelProperty='UHI'
        )
        
        # Simplify polygons
        simplified = vectors.map(lambda f: f.simplify(100))
        
        # Convert to GeoJSON
        geojson = geemap.ee_to_geojson(simplified, scale=500)
        
        return {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {
                    "threshold": threshold,
                    "period_days": days,
                    "suggestion": "urban_greening",
                    "priority": "high",
                    "estimated_cooling": "2-5°C"
                },
                "geometry": geojson
            }]
        }
        
    except Exception as e:
        logger.error(f"Error calculating mitigation areas: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
