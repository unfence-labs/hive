const CITIES = [
  "tokyo", "berlin", "lagos", "mumbai", "oslo", "lima", "cairo", "seoul",
  "nairobi", "dublin", "lisbon", "prague", "havana", "manila", "bogota",
  "hanoi", "athens", "dakar", "quito", "rabat", "accra", "baku", "minsk",
  "riga", "tunis", "doha", "muscat", "skopje", "panama", "kabul",
  "amsterdam", "bangkok", "copenhagen", "delhi", "edinburgh", "florence",
  "geneva", "helsinki", "istanbul", "jakarta", "kyoto", "lyon", "madrid",
  "naples", "osaka", "porto", "quebec", "reykjavik", "santiago", "toronto",
  "utrecht", "vienna", "warsaw", "xiamen", "yokohama", "zurich",
  "auckland", "brisbane", "colombo", "denver", "fargo", "gdansk",
  "houston", "incheon", "jaipur", "krakow", "luanda", "malmo", "nantes",
  "odessa", "perth", "reno", "sofia", "tallinn", "ushuaia", "vancouver",
  "wellington", "xian", "yerevan", "zagreb",
  "abuja", "beirut", "cusco", "durban", "exeter", "fukuoka", "granada",
  "harare", "izmir", "jersey", "kampala", "leiden", "maputo", "nicosia",
  "oxford", "puebla", "rosario", "split", "tirana", "vilnius",
  "windhoek", "yangon", "zanzibar", "algiers", "bamako", "cartagena",
  "dijon", "entebbe", "freetown", "graz", "hague", "innsbruck", "jeddah",
  "kisumu", "lome", "merida", "nassau", "okinawa", "patras", "queens",
  "rouen", "sendai", "toledo", "ulsan", "varna", "wuhan", "xalapa",
  "yazd", "zaragoza", "agadir", "bilbao", "cannes", "darwin", "essen",
  "fez", "ghent", "hilo", "ibiza", "jodhpur", "kazan", "lecce", "malaga",
  "natal", "omaha", "palermo", "rennes", "siena", "tartu", "urbino",
  "valparaiso", "wroclaw", "xiangtan", "yaounde", "zilina",
  "anchorage", "brest", "chartres", "davao", "erie", "faro", "gijon",
  "hobart", "iquitos", "juneau", "kochi", "lucca", "metz", "nagoya",
  "oulu", "padua", "ragusa", "stavanger", "turku", "ulaanbaatar",
  "versailles", "wollongong", "xining", "yakutsk", "zermatt",
] as const;

export function pickCityName(usedNames: string[]): string {
  const available = CITIES.filter((c) => !usedNames.includes(c));
  if (available.length === 0) {
    throw new Error("All city names exhausted");
  }
  return available[Math.floor(Math.random() * available.length)];
}

export { CITIES };
