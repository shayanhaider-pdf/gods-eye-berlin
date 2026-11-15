import {getSpaceLayer} from './world-space.js';
import {getGroundLayer,groundKinds} from './world-ground.js';
import {getContextLayer} from './world-context.js';

const spaceKinds = ['earthquakes','satellites','launches','fires','cyclones'];
const contextKinds = ['news','wildlife','radio','militaryFlights','firePerimeters','airquality','clouds','lightning'];
export const worldKinds = [...spaceKinds,...groundKinds,...contextKinds];
export async function getWorldLayer(kind,area,env={}) {
  if (!worldKinds.includes(kind) || !Number.isFinite(area.lat) || !Number.isFinite(area.lon) || Math.abs(area.lat)>85 || Math.abs(area.lon)>180 || !Number.isFinite(area.radius) || area.radius<1 || area.radius>20) throw new RangeError('Choose a valid source, coordinates and radius between 1 and 20 km.');
  return (spaceKinds.includes(kind)?getSpaceLayer:groundKinds.includes(kind)?getGroundLayer:getContextLayer)(kind,area,env);
}
