from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import rasterio
import geopandas as gpd
from shapely.geometry import Polygon
import numpy as np
import json
import os
import rasterio.warp

app = FastAPI(title="Lahore UHI Mapper API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lahore bounding box (approximate)
LAHORE_BOUNDS = [74.1472, 31.3000, 74.5500, 31.6920]
LAHORE_GEOM = Polygon([
    (LAHORE_BOUNDS[0], LAHORE_BOUNDS[1]),
    (LAHORE_BOUNDS[2], LAHORE_BOUNDS[1]),
    (LAHORE_BOUNDS[2], LAHORE_BOUNDS[3]),
    (LAHORE_BOUNDS[0], LAHORE_BOUNDS[3]),
    (LAHORE_BOUNDS[0], LAHORE_BOUNDS[1])
])

def get_uhi_data_from_rasters():
    """
    Reads MODIS LST data from a local file, processes it, and returns it as GeoJSON.
    Assumes a pre-downloaded 'modis_lst.tif' file exists.
    """
    try:
        file_path = os.path.join('data', 'modis_lst.tif')
        with rasterio.open(file_path) as src:
            lst_data = src.read(1)
            transform = src.transform
            
            # Convert raster to a GeoDataFrame
            rows, cols = np.where(~np.isnan(lst_data))
            polygons = []
            values = []

            for row, col in zip(rows, cols):
                # Create a polygon for each pixel
                poly_coords = [
                    (transform * (col, row)),
                    (transform * (col + 1, row)),
                    (transform * (col + 1, row + 1)),
                    (transform * (col, row + 1))
                ]
                polygons.append(Polygon(poly_coords))
                values.append(lst_data[row, col])

            gdf = gpd.GeoDataFrame({'lst': values}, geometry=polygons, crs=src.crs)
            
            # Clip the GeoDataFrame to the Lahore bounds
            lahore_gdf = gpd.GeoDataFrame(index=[0], crs='EPSG:4326', geometry=[LAHORE_GEOM])
            gdf = gpd.overlay(gdf.to_crs('EPSG:4326'), lahore_gdf, how='intersection')

            return json.loads(gdf.to_json())

    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="MODIS LST raster file not found. Please download and place 'modis_lst.tif' in the 'data' directory.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def get_mitigation_data_from_rasters():
    """
    Reads local LST and NDVI raster files, identifies hotspots, and returns them as GeoJSON.
    Assumes 'modis_lst.tif' and 'sentinel2_ndvi.tif' are available.
    """
    try:
        lst_path = os.path.join('data', 'modis_lst.tif')
        ndvi_path = os.path.join('data', 'sentinel2_ndvi.tif')

        with rasterio.open(lst_path) as lst_src, rasterio.open(ndvi_path) as ndvi_src:
            # Reproject NDVI to match the LST raster
            reprojected_ndvi, reprojected_transform = rasterio.warp.reproject(
                source=rasterio.band(ndvi_src, 1),
                destination=np.empty_like(lst_src.read(1), dtype='float32'),
                src_transform=ndvi_src.transform,
                src_crs=ndvi_src.crs,
                dst_transform=lst_src.transform,
                dst_crs=lst_src.crs,
                resampling=rasterio.enums.Resampling.bilinear
            )

            lst_data = lst_src.read(1)
            
            # Identify hotspots: LST > 35°C AND NDVI < 0.2
            hotspot_mask = (lst_data > 35) & (reprojected_ndvi < 0.2)
            hotspot_coords = np.argwhere(hotspot_mask)

            hotspot_points = []
            transform = lst_src.transform
            for row, col in hotspot_coords:
                x, y = transform * (col + 0.5, row + 0.5)
                hotspot_points.append({'lat': y, 'lon': x})
        
        # Convert points to GeoJSON
        features = [{
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [p['lon'], p['lat']]},
            "properties": {
                "suggestion": "tree_planting",
                "priority": "high",
                "estimated_cooling": "2-5"
            }
        } for p in hotspot_points]

        return {"type": "FeatureCollection", "features": features}

    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Required raster files not found. Please check the 'data' directory.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/uhi-data")
async def get_uhi_endpoint():
    """Endpoint for UHI data."""
    return get_uhi_data_from_rasters()

@app.get("/mitigation-suggestions")
async def get_mitigation_endpoint():
    """Endpoint for mitigation suggestions."""
    return get_mitigation_data_from_rasters()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
