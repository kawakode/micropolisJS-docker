/* micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details. Alternatively,
 * consult http://micropolisjs.graememcc.co.uk/LICENSE and
 * http://micropolisjs.graememcc.co.uk/COPYING
 *
 * The name/term "MICROPOLIS" is a registered trademark of Micropolis (https://www.micropolis.com) GmbH
 * (Micropolis Corporation, the "licensor") and is licensed here to the authors/publishers of the "Micropolis"
 * city simulation game and its source code (the project or "licensee(s)") as a courtesy of the owner.
 *
 */

import { BuildingTool } from './buildingTool.js';
import { BulldozerTool } from './bulldozerTool.js';
import { EventEmitter } from './eventEmitter.js';
import { GameMap } from './gameMap.js';
import { TerrainTool } from './terrainTool.js';
import { BULLBIT, BURNBIT } from "./tileFlags.ts";
import { QUERY_WINDOW_NEEDED } from './messages.ts';
import { MiscUtils } from './miscUtils.js';
import { ParkTool } from './parkTool.js';
import { RailTool } from './railTool.js';
import { RoadTool } from './roadTool.js';
import { QueryTool } from './queryTool.js';
import * as TileValues from "./tileValues.ts";
import { WireTool } from './wireTool.js';

function GameTools(map) {
  var tools = EventEmitter({
    airport: new BuildingTool(10000, TileValues.AIRPORT, map, 6, false),
    bulldozer: new BulldozerTool(map),
    coal: new BuildingTool(3000, TileValues.POWERPLANT, map, 4, false),
    commercial: new BuildingTool(100, TileValues.COMCLR, map, 3, false),
    fire: new BuildingTool(500, TileValues.FIRESTATION, map, 3, false),
    industrial: new BuildingTool(100, TileValues.INDCLR, map, 3, false),
    nuclear: new BuildingTool(5000, TileValues.NUCLEAR, map, 4, true),
    park: new ParkTool(map),
    police: new BuildingTool(500, TileValues.POLICESTATION, map, 3, false),
    port: new BuildingTool(3000, TileValues.PORT, map, 4, false),
    rail: new RailTool(map),
    residential: new BuildingTool(100, TileValues.FREEZ, map, 3, false),
    road: new RoadTool(map),
    query: new QueryTool(map),
    stadium: new BuildingTool(5000, TileValues.STADIUM, map, 4, false),
    wire: new WireTool(map),

    // KawaCity's tools (see Toolbar)
    dirtroad: new RoadTool(map, GameMap.ROAD_DIRT, 4, 0),
    avenue: new RoadTool(map, GameMap.ROAD_AVENUE, 25, 100),
    highway: new RoadTool(map, GameMap.ROAD_HIGHWAY, 40, 150),
    wind: new BuildingTool(300, TileValues.WINDTURBINE, map, 1, true),
    solar: new BuildingTool(2000, TileValues.SOLARPLANT, map, 3, false),
    gas: new BuildingTool(2000, TileValues.GASPLANT, map, 3, false),
    school: new BuildingTool(1000, TileValues.SCHOOL, map, 3, false),
    hospital: new BuildingTool(1500, TileValues.HOSPITAL, map, 3, false),
    university: new BuildingTool(3000, TileValues.UNIVERSITY, map, 4, false),
    bigpark: new BuildingTool(400, TileValues.BIGPARK, map, 3, false),
    garden: new TerrainTool(map, TerrainTool.LAY, 25, TileValues.GARDEN, BULLBIT | BURNBIT),
    plaza: new TerrainTool(map, TerrainTool.LAY, 40, TileValues.PLAZA, BULLBIT),
    trees: new TerrainTool(map, TerrainTool.PLANT, 5),
    water: new TerrainTool(map, TerrainTool.DIG, 100),
    landfill: new TerrainTool(map, TerrainTool.FILL, 60),
  });

  // The bulldozer's sizes are one tool, applied over a wider area (see InputStatus)
  tools.bulldozer3 = tools.bulldozer5 = tools.bulldozer7 = tools.bulldozer;

  tools.query.addEventListener(QUERY_WINDOW_NEEDED, MiscUtils.reflectEvent.bind(tools, QUERY_WINDOW_NEEDED));

  return tools;
}


export { GameTools };
