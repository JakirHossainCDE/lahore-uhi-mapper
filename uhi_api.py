from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta
import ee
import json
from typing import Optional

# Initialize Google Earth Engine
try:
    ee.Initialize()
except Exception as e:
    print("Please authenticate Earth Engine first:")
    print("Run: earthengine authenticate in your terminal")
    raise

app = FastAPI(title="Lahore UHI Mapper API with MODIS and Sentinel-2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lahore bounding coordinates
LAHORE_BOUNDS = ee.Geometry.Rectangle([74.1472, 31.3000, 74.5500, 31.6920])

def get_modis_lst(start_date: str, end_date: str, cloud_cover: int = 10):
    """
    Fetches MODIS Land Surface Temperature data.
    The MODIS LST product is already processed, so we just select the band and scale.
    """
    modis_lst = ee.ImageCollection('MODIS/061/MOD11A1') \
        .filterBounds(LAHORE_BOUNDS) \
        .filterDate(start_date, end_date) \
        .select('LST_Day_1km') \
        .mean() \
        .clip(LAHORE_BOUNDS)
    
    # MODIS LST is in Kelvin * 0.02. We convert it to Celsius.
    # LST = (LST_Day_1km * 0.02) - 273.15
    lst_celsius = modis_lst.multiply(0.02).subtract(273.15).rename('lst')
    return lst_celsius

def get_sentinel2_ndvi(start_date: str, end_date: str, cloud_cover: int = 10):
    """
    Calculates NDVI from Sentinel-2 data.
    """
    sentinel = ee.ImageCollection('COPERNICUS/S2_SR') \
        .filterBounds(LAHORE_BOUNDS) \
        .filterDate(start_date, end_date) \
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloud_cover)) \
        .select('B8', 'B4')
    
    def calculate_ndvi(image):
        ndvi = image.normalizedDifference(['B8', 'B4']).rename('ndvi')
        return ndvi.copyProperties(image, ['system:time_start'])
    
    return sentinel.map(calculate_ndvi).mean().clip(LAHORE_BOUNDS)

@app.get("/uhi-data")
async def get_uhi_data(
    start_date: str = Query((datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")),
    end_date: str = Query(datetime.now().strftime("%Y-%m-%d")),
    resolution: int = Query(1000, description="Output resolution in meters. MODIS is 1km.")
):
    """Get UHI data from MODIS as GeoJSON."""
    try:
        lst_image = get_modis_lst(start_date, end_date)
        
        if not lst_image.bandNames().size().getInfo():
            raise HTTPException(status_code=404, detail="No MODIS LST data found for the specified date range.")

        # Convert the LST image to a feature collection of polygons
        lst_vector = lst_image.reduceToVectors(
            geometry=LAHORE_BOUNDS,
            scale=resolution,
            geometryType='polygon',
            labelProperty='lst',
            tileScale=16
        )
        geojson = json.loads(lst_vector.serialize())
        
        return geojson
        
    except Exception as e:
        print(f"Error in /uhi-data: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/mitigation-suggestions")
async def get_mitigation_suggestions(
    threshold: float = Query(3.0, description="Minimum UHI intensity threshold in Celsius")
):
    """Get mitigation suggestions based on MODIS UHI and Sentinel-2 NDVI."""
    try:
        end_date = datetime.now().strftime("%Y-%m-%d")
        start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
        
        lst_image = get_modis_lst(start_date, end_date)
        ndvi_image = get_sentinel2_ndvi(start_date, end_date)

        if not lst_image.bandNames().size().getInfo():
             raise HTTPException(status_code=404, detail="No LST data found for mitigation analysis.")
        if not ndvi_image.bandNames().size().getInfo():
             raise HTTPException(status_code=404, detail="No NDVI data found for mitigation analysis.")

        # Identify potential hotspot areas (high LST, low NDVI)
        # Note: MODIS resolution is 1km, Sentinel-2 is 10m. Resample NDVI to match LST.
        ndvi_resampled = ndvi_image.reproject(crs=lst_image.projection().crs(), scale=1000)
        
        hotspots = lst_image.gt(threshold).And(ndvi_resampled.lt(0.2)).selfMask()

        hotspot_points = hotspots.reduceToVectors(
            geometry=LAHORE_BOUNDS,
            scale=1000,
            geometryType='point',
            tileScale=16
        )
        
        def add_properties(feature):
            return feature.set({
                'suggestion': 'tree_planting',
                'priority': 'high',
                'estimated_cooling': '2-5'
            })
        
        suggestions = hotspot_points.map(add_properties)
        geojson = json.loads(suggestions.serialize())
        
        return geojson
        
    except Exception as e:
        print(f"Error in /mitigation-suggestions: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
