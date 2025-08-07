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
    # Filter Landsat collection
    landsat = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2') \
        .filterBounds(LAHORE_BOUNDS) \
        .filterDate(start_date, end_date) \
        .filter(ee.Filter.lt('CLOUD_COVER', cloud_cover))
    
    # Calculate LST in Celsius
    def calculate_lst(image):
        lst = image.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15)
        return lst.rename('LST')
    
    return landsat.map(calculate_lst).mean().clip(LAHORE_BOUNDS)

def get_ndvi_data(start_date: str, end_date: str, cloud_cover: int = 10):
    """Calculate NDVI from Sentinel-2"""
    sentinel = ee.ImageCollection('COPERNICUS/S2_SR') \
        .filterBounds(LAHORE_BOUNDS) \
        .filterDate(start_date, end_date) \
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloud_cover))
    
    def calculate_ndvi(image):
        ndvi = image.normalizedDifference(['B8', 'B4']).rename('NDVI')
        return ndvi
    
    return sentinel.map(calculate_ndvi).mean().clip(LAHORE_BOUNDS)

def calculate_uhi(lst_image):
    """Calculate Urban Heat Island intensity"""
    rural_mean = lst_image.reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=LAHORE_BOUNDS,
        scale=100,
        bestEffort=True
    ).get('LST')
    
    uhi = lst_image.subtract(ee.Image.constant(rural_mean)).rename('UHI')
    return uhi

@app.get("/uhi-data")
async def get_uhi_data(
    start_date: str = Query((datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")),
    end_date: str = Query(datetime.now().strftime("%Y-%m-%d")),
    cloud_cover: int = Query(10),
    resolution: int = Query(100, description="Output resolution in meters")
):
    """Get UHI data from Google Earth Engine"""
    try:
        # Get LST data
        lst_image = get_lst_data(start_date, end_date, cloud_cover)
        ndvi_image = get_ndvi_data(start_date, end_date, cloud_cover)
        uhi_image = calculate_uhi(lst_image)
        
        # Create a composite image
        composite = ee.Image.cat([lst_image, ndvi_image, uhi_image])
        
        # Convert to GeoJSON
        geojson = geemap.ee_to_geojson(
            composite,
            LAHORE_BOUNDS,
            resolution
        )
        
        return {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {
                    "start_date": start_date,
                    "end_date": end_date,
                    "resolution": resolution
                },
                "geometry": geojson
            }]
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/mitigation-suggestions")
async def get_mitigation_suggestions(
    threshold: float = Query(2.0, description="Minimum UHI intensity threshold")
):
    """Get mitigation suggestions based on UHI hotspots"""
    try:
        # Get recent UHI data
        end_date = datetime.now().strftime("%Y-%m-%d")
        start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
        uhi_image = calculate_uhi(get_lst_data(start_date, end_date))
        
        # Identify hotspots
        hotspots = uhi_image.gt(threshold).selfMask()
        
        # Convert hotspots to vectors
        hotspots_vector = hotspots.reduceToVectors(
            geometry=LAHORE_BOUNDS,
            scale=100,
            geometryType='polygon'
        )
        
        # Get centroid of each hotspot
        centroids = hotspots_vector.map(lambda f: f.centroid())
        
        # Convert to GeoJSON
        geojson = geemap.ee_to_geojson(centroids)
        
        return {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {
                    "threshold": threshold,
                    "suggestion": "urban_greening",
                    "priority": "high"
                },
                "geometry": geojson
            }]
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)