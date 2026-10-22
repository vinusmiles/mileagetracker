// Shared constants for vehicles and fuel. Units live here so that CNG (kg) and
// electric (kWh) can be switched on later without changing the data model.

export const VEHICLE_TYPES = {
  two: { label: 'Two-wheeler' },
  four: { label: 'Four-wheeler' },
};

export const FUEL_TYPES = {
  petrol: { label: 'Petrol', unit: 'L', unitName: 'litres', enabled: true },
  diesel: { label: 'Diesel', unit: 'L', unitName: 'litres', enabled: true },
  cng: { label: 'CNG', unit: 'kg', unitName: 'kg', enabled: false },
  electric: { label: 'Electric', unit: 'kWh', unitName: 'kWh', enabled: false },
};

export const fuelUnit = (fuelType) => (FUEL_TYPES[fuelType] || FUEL_TYPES.petrol).unit;
export const fuelUnitName = (fuelType) => (FUEL_TYPES[fuelType] || FUEL_TYPES.petrol).unitName;

export const LIMITS = {
  nicknameMax: 40,
  textMax: 120,
  notesMax: 500,
  odometerMax: 9_999_999,
  quantityMax: 1000,
  amountMax: 1_000_000,
  earliestDate: '1990-01-01',
};
