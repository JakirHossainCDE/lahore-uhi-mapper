from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta
import ee
import json
import os
import geemap
from typing import Optional

# Initialize Google Earth Engine
try:
    ee.Initialize()
except Exception as e:
    print("Please authenticate Earth Engine first:")
    print("Run: earthengine authenticate in your terminal")
    raise

app = FastAPI(title="Lahore UHI Mapper API with GEE")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lahore bounding coordinates
LAHORE_BOUNDS = ee.Geometry.Rectangle([74.1472, 31.3000, 74.5500, 31.6920])

def get_lst_data(start_date: str, end_date: str, cloud_cover: int = 10):
    """Calculate Land Surface Temperature from Landsat 8/9"""
    landsat = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2') \
        .filterBounds(LAHORE_BOUNDS) \
        .filterDate(start_date, end_date) \
        .filter(ee.Filter.lt('CLOUD_COVER', cloud_cover))
    
    def calculate_lst(image):
        # Scale and convert to Celsius
        lst = image.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15)
        return lst.rename('lst').copyProperties(image, ['system:time_start'])
    
    return landsat.map(calculate_lst).mean().clip(LAHORE_BOUNDS)

def get_ndvi_data(start_date: str, end_date: str, cloud_cover: int = 10):
    """Calculate NDVI from Sentinel-2"""
    sentinel = ee.ImageCollection('COPERNICUS/S2_SR') \
        .filterBounds(LAHORE_BOUNDS) \
        .filterDate(start_date, end_date) \
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloud_cover))
    
    def calculate_ndvi(image):
        ndvi = image.normalizedDifference(['B8', 'B4']).rename('ndvi')
        return ndvi.copyProperties(image, ['system:time_start'])
    
    return sentinel.map(calculate_ndvi).mean().clip(LAHORE_BOUNDS)

@app.get("/uhi-data")
async def get_uhi_data(
    start_date: str = Query((datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")),
    end_date: str = Query(datetime.now().strftime("%Y-%m-%d")),
    cloud_cover: int = Query(10, description="Maximum cloud cover percentage"),
    resolution: int = Query(100, description="Output resolution in meters")
):
    """Get UHI data from Google Earth Engine as GeoJSON."""
    try:
        lst_image = get_lst_data(start_date, end_date, cloud_cover)
        
        # Check if the image is empty
        if not lst_image.bandNames().size().getInfo():
            raise HTTPException(status_code=404, detail="No Landsat data found for the specified date range.")

        # Convert the LST image to a feature collection of polygons
        lst_vector = lst_image.reduceToVectors(
            geometry=LAHORE_BOUNDS,
            scale=resolution,
            geometryType='polygon',
            labelProperty='lst',
            tileScale=16
        )

        # Convert the feature collection to GeoJSON
        geojson = json.loads(lst_vector.serialize())
        
        return geojson
        
    except Exception as e:
        # Log the error for debugging
        print(f"Error in /uhi-data: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/mitigation-suggestions")
async def get_mitigation_suggestions(
    threshold: float = Query(2.0, description="Minimum UHI intensity threshold in Celsius")
):
    """Get mitigation suggestions based on UHI hotspots."""
    try:
        end_date = datetime.now().strftime("%Y-%m-%d")
        start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
        
        lst_image = get_lst_data(start_date, end_date)
        ndvi_image = get_ndvi_data(start_date, end_date)

        # Check for empty images
        if not lst_image.bandNames().size().getInfo():
             raise HTTPException(status_code=404, detail="No LST data found for mitigation analysis.")
        if not ndvi_image.bandNames().size().getInfo():
             raise HTTPException(status_code=404, detail="No NDVI data found for mitigation analysis.")

        # Identify potential hotspot areas (high LST, low NDVI)
        # Assuming low NDVI is < 0.2 (common for non-vegetated areas)
        hotspots = lst_image.gt(threshold).And(ndvi_image.lt(0.2)).selfMask()

        # Convert hotspots to a feature collection of points for suggestions
        hotspot_points = hotspots.reduceToVectors(
            geometry=LAHORE_BOUNDS,
            scale=30, # Higher resolution for better hotspot detection
            geometryType='point',
            tileScale=16
        )
        
        # Add properties to the points for display
        def add_properties(feature):
            return feature.set({
                'suggestion': 'tree_planting',
                'priority': 'high',
                'estimated_cooling': '2-5' # Placeholder, needs a more complex model
            })
        
        suggestions = hotspot_points.map(add_properties)
        
        # Convert to GeoJSON
        geojson = json.loads(suggestions.serialize())
        
        return geojson
        
    except Exception as e:
        print(f"Error in /mitigation-suggestions: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
