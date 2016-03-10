

L.SVG.Tile = L.SVG.extend({

	initialize: function (tileSize, options) {
		L.SVG.prototype.initialize.call(this, options);
		this._size = tileSize;

		this._initContainer();
		this._container.setAttribute('width', this._size.x);
		this._container.setAttribute('height', this._size.y);
		this._container.setAttribute('viewBox', [0, 0, this._size.x, this._size.y].join(' '));
	},

	getContainer: function() {
		return this._container;
	},

// 	onAdd: function() {},
	onAdd: L.Util.FalseFn,

	_initContainer: function() {
		L.SVG.prototype._initContainer.call(this);
		var rect =  L.SVG.create('rect');

// 		rect.setAttribute('x', 0);
// 		rect.setAttribute('y', 0);
// 		rect.setAttribute('width', this._size.x);
// 		rect.setAttribute('height', this._size.y);
// 		rect.setAttribute('fill', 'transparent');
// 		rect.setAttribute('stroke', 'black');
// 		rect.setAttribute('stroke-width', 2);
// 		this._rootGroup.appendChild(rect);
	},

	/// TODO: Modify _initPath to include an extra parameter, a group name
	/// to order symbolizers by z-index

	_addPath: function (layer) {
		this._rootGroup.appendChild(layer._path);
	},

});


L.svg.tile = function(tileSize, opts){
	return new L.SVG.Tile(tileSize, opts);
}






L.Canvas.Tile = L.Canvas.extend({

	initialize: function (tileSize, options) {
		L.Canvas.prototype.initialize.call(this, options);
		this._size = tileSize;

		this._initContainer();
		this._container.setAttribute('width', this._size.x);
		this._container.setAttribute('height', this._size.y);
		this._layers = {};
		this._drawnLayers = {};
	},

	getContainer: function() {
		return this._container;
	},

	onAdd: L.Util.FalseFn,

	_initContainer: function () {
		var container = this._container = document.createElement('canvas');

// 		L.DomEvent
// 			.on(container, 'mousemove', L.Util.throttle(this._onMouseMove, 32, this), this)
// 			.on(container, 'click dblclick mousedown mouseup contextmenu', this._onClick, this)
// 			.on(container, 'mouseout', this._handleMouseOut, this);

		this._ctx = container.getContext('2d');
	},


	/// TODO: Modify _initPath to include an extra parameter, a group name
	/// to order symbolizers by z-index

});


L.canvas.tile = function(tileSize, opts){
	return new L.Canvas.Tile(tileSize, opts);
}






L.VectorGrid = L.GridLayer.extend({

	options: {
		rendererFactory: L.svg.tile,
		vectorTileLayerStyles: {}
	},

	createTile: function(coords, done) {
		var renderer = this.options.rendererFactory(this.getTileSize(), this.options);

		var vectorTilePromise = this._getVectorTilePromise(coords);


		vectorTilePromise.then( function(vectorTile) {

			for (var layerName in vectorTile.layers) {
				var layer = vectorTile.layers[layerName];

				/// NOTE: THIS ASSUMES SQUARE TILES!!!!!1!
				var pxPerExtent = this.getTileSize().x / layer.extent;

				var layerStyle = this.options.vectorTileLayerStyles[ layerName ] ||
				L.Path.prototype.options;

				for (var i in layer.features) {
					var feat = layer.features[i];
					this._mkFeatureParts(feat, pxPerExtent);

					/// Style can be a callback that is passed the feature's
					/// properties and tile zoom level...
					var styleOptions = (layerStyle instanceof Function) ?
					layerStyle(feat.properties, coords.z) :
					layerStyle;

					if (!(styleOptions instanceof Array)) {
						styleOptions = [styleOptions];
					}

					/// Style can be an array of styles, for styling a feature
					/// more than once...
					for (var j in styleOptions) {
						var style = L.extend({}, L.Path.prototype.options, styleOptions[j]);

						if (feat.type === 1) { // Points
							style.fill = false;
						} else if (feat.type === 2) {	// Polyline
							style.fill = false;
						}

						feat.options = style;
						renderer._initPath( feat );
						renderer._updateStyle( feat );

						if (feat.type === 1) { // Points
							// 							style.fill = false;
						} else if (feat.type === 2) {	// Polyline
							style.fill = false;
							renderer._updatePoly(feat, false);
						} else if (feat.type === 3) {	// Polygon
							renderer._updatePoly(feat, true);
						}

						renderer._addPath( feat );
					}
				}

			}
			L.Util.requestAnimFrame(done);
		}.bind(this));

		return renderer.getContainer();
	},



	// Fills up feat._parts based on the geometry and pxPerExtent,
	// pretty much as L.Polyline._projectLatLngs and L.Polyline._clipPoints
	// would do but simplified as the vectors are already simplified/clipped.
	_mkFeatureParts: function(feat, pxPerExtent) {

		var rings = feat.geometry;

		feat._parts = [];
		for (var i in rings) {
			var ring = rings[i];
			var part = [];
			for (var j in ring) {
				var coord = ring[j];
				if ('x' in coord) {
					// Protobuf vector tiles return {x: , y:}
					part.push(L.point(coord.x * pxPerExtent, coord.y * pxPerExtent));
				} else {
					// Geojson-vt returns [,]
					part.push(L.point(coord[0] * pxPerExtent, coord[1] * pxPerExtent));
				}
			}
			feat._parts.push(part);
		}

	},

});



L.vectorGrid = function (options) {
	return new L.VectorGrid(options);
};









// geojson-vt powered!
// NOTE: Assumes the global `geojsonvt` exists!!!
L.VectorGrid.Slicer = L.VectorGrid.extend({

	options: {
		vectorTileLayerName: 'sliced',
		extent: 4096	// Default for geojson-vt
	},

	initialize: function(geojson, options) {
		L.VectorGrid.prototype.initialize.call(this, options);


		this._slicers = {};
		if (geojson.type && geojson.type === 'Topology') {
			// geojson is really a topojson
			for (var layerName in geojson.objects) {
				this._slicers[layerName] = geojsonvt(
					topojson.feature(geojson, geojson.objects[layerName])
				, this.options);
			}
		} else {
			// For a geojson, create just one vectortilelayer named with the value
			// of the option.
			// Inherits available options from geojson-vt!
			this._slicers[options.vectorTileLayerName] = geojsonvt(geojson, this.options);
		}

	},

	_getVectorTilePromise: function(coords) {

		var tileLayers = {};

		for (var layerName in this._slicers) {
			var slicer = this._slicers[layerName];
			var slicedTileLayer = slicer.getTile(coords.z, coords.x, coords.y);

			if (slicedTileLayer) {
				var vectorTileLayer = {
					features: [],
					extent: this.options.extent,
					name: this.options.vectorTileLayerName,
					length: slicedTileLayer.features.length
				}

				for (var i in slicedTileLayer.features) {
					var feat = {
						geometry: slicedTileLayer.features[i].geometry,
						properties: slicedTileLayer.features[i].tags,
						type: slicedTileLayer.features[i].type	// 1 = point, 2 = line, 3 = polygon
					}
					vectorTileLayer.features.push(feat);
				}

				tileLayers[layerName] = vectorTileLayer;
			}

		}

		return new Promise(function(resolve){ return resolve({ layers: tileLayers })});
	},
	
});


L.vectorGrid.slicer = function (geojson, options) {
	return new L.VectorGrid.Slicer(geojson, options);
};





// Network & Protobuf powered!
// NOTE: Assumes the globals `VectorTile` and `Pbf` exist!!!
L.VectorGrid.Protobuf = L.VectorGrid.extend({

	options: {
		subdomains: 'abc',	// Like L.TileLayer
	},


	initialize: function(url, options) {
		// Inherits options from geojson-vt!
// 		this._slicer = geojsonvt(geojson, options);
		this._url = url;
		L.VectorGrid.prototype.initialize.call(this, options);
	},


	_getSubdomain: L.TileLayer.prototype._getSubdomain,


	_getVectorTilePromise: function(coords) {
		var tileUrl = L.Util.template(this._url, L.extend({
			s: this._getSubdomain(coords),
			x: coords.x,
			y: coords.y,
			z: coords.z
// 			z: this._getZoomForUrl()	/// TODO: Maybe replicate TileLayer's maxNativeZoom
		}, this.options));

		return fetch(tileUrl).then(function(response){

			if (!response.ok) {
				return {layers:[]};
			}

			return response.blob().then( function (blob) {
// 				console.log(blob);

				var reader = new FileReader();
				return new Promise(function(resolve){
					reader.addEventListener("loadend", function() {
						// reader.result contains the contents of blob as a typed array

						// blob.type === 'application/x-protobuf'
						var pbf = new Pbf( reader.result );
// 						console.log(pbf);
						return resolve(new vectorTile.VectorTile( pbf ));

					});
					reader.readAsArrayBuffer(blob);
				});
			});
		}).then(function(json){

// 			console.log('Vector tile:', json.layers);
// 			console.log('Vector tile water:', json.layers.water);	// Instance of VectorTileLayer

			// Normalize feature getters into actual instanced features
			for (var layerName in json.layers) {
				var feats = [];

				for (var i=0; i<json.layers[layerName].length; i++) {
					var feat = json.layers[layerName].feature(i);
					feat.geometry = feat.loadGeometry();
					feats.push(feat);
				}

				json.layers[layerName].features = feats;
			}

			return json;
		});
	}
});


L.vectorGrid.protobuf = function (url, options) {
	return new L.VectorGrid.Protobuf(url, options);
};
//# sourceMappingURL=Leaflet.VectorGrid.js.map