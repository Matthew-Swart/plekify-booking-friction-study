/**
 * CEM property matrix v2 — Protocol v2 §5
 * Covariates for Coarsened Exact Matching: tier, volumeClass, region, distribution.
 * Seeds for the v1-verified incumbents + Plekify public microsites. New entrants
 * (Mews/Stayntouch/OPERA + OTAs) are appended from the property-research pass.
 *
 * Plekify uses the PUBLIC plekify.com microsites (travel-2022 store), not the
 * password-protected client demo stores — keeps the baseline fair/representative.
 */
export const PROPERTIES = [
  // ---------------- PLEKIFY (public bookable product pages on plekify.com — travel-search widget) ----------------
  { system: 'plekify', name: 'Plekify · Simbavati Hilltop', homepageUrl: 'https://plekify.com/products/simbavati-hilltop-lodge', bookingUrl: 'https://plekify.com/products/simbavati-hilltop-lodge', tier: 'luxury', volumeClass: 'medium', region: 'Africa', distribution: 'direct+ota' },
  { system: 'plekify', name: 'Plekify · Hemingways Watamu', homepageUrl: 'https://plekify.com/products/hemingways-watamu-1-bedroom-ocean-view-suite', bookingUrl: 'https://plekify.com/products/hemingways-watamu-1-bedroom-ocean-view-suite', tier: 'upscale', volumeClass: 'medium', region: 'Africa', distribution: 'direct+ota' },
  { system: 'plekify', name: 'Plekify · Zannier Omaanda', homepageUrl: 'https://plekify.com/products/zannier-omaanda-1-bedroom-hut', bookingUrl: 'https://plekify.com/products/zannier-omaanda-1-bedroom-hut', tier: 'luxury', volumeClass: 'medium', region: 'Africa', distribution: 'direct+ota' },

  // ---------------- SITEMINDER (direct-book.com SPA; date-prefilled deep-link bypasses calendar) ----------------
  { system: 'siteminder', name: 'Ivy City Hotel', homepageUrl: 'https://www.ivycityhotel.com/', smSlug: 'ivycityhoteldirect', tier: 'upscale', volumeClass: 'medium', region: 'North America', distribution: 'direct+ota' },
  { system: 'siteminder', name: 'Nantucket Whale Inn', homepageUrl: 'https://www.nantucketwhaleinn.com/', smSlug: 'nantucketdirect', tier: 'midscale', volumeClass: 'low', region: 'North America', distribution: 'direct+ota' },
  { system: 'siteminder', name: 'Tremola-San Gottardo', homepageUrl: 'https://www.tremola-sangottardo.ch/english', smSlug: 'BedNBikeTremolaSanGottardoDIRECT', tier: 'midscale', volumeClass: 'low', region: 'Europe', distribution: 'direct+ota' },

  // ---------------- CLOUDBEDS (hotels.cloudbeds.com Chakra; deep-link; add-to-cart agent-block) ----------------
  { system: 'cloudbeds', name: 'Saltline Hotel', homepageUrl: 'https://www.saltlinehotel.com/', cbId: 'Cy0z7M', tier: 'midscale', volumeClass: 'low', region: 'North America', distribution: 'direct+ota' },
  { system: 'cloudbeds', name: 'Fatwave Surf Resort', homepageUrl: 'https://www.fatwavesurfresort.com/', cbId: 'SoRbvN', tier: 'midscale', volumeClass: 'low', region: 'Asia', distribution: 'direct+ota' },
  { system: 'cloudbeds', name: 'Sea Esta Komodo', homepageUrl: 'https://seaestakomodo.com/', cbId: null, tier: 'midscale', volumeClass: 'low', region: 'Asia', distribution: 'direct+ota', note: 'reservation id behind SiteGround sgcaptcha — pending' },

  // ---------------- NIGHTSBRIDGE (v1-verified working) ----------------
  { system: 'nightsbridge', name: 'Atlantic View', homepageUrl: 'https://atlanticviewcapetown.com/', bookingUrl: 'https://book.nightsbridge.com/30738', tier: 'upscale', volumeClass: 'low', region: 'Africa', distribution: 'direct+ota' },
  { system: 'nightsbridge', name: 'Thali Thali', homepageUrl: 'https://www.thalithali.co.za/', bookingUrl: 'https://book.nightsbridge.com/19876', tier: 'midscale', volumeClass: 'low', region: 'Africa', distribution: 'direct+ota' },
  { system: 'nightsbridge', name: 'Lairds Lodge', homepageUrl: 'https://www.lairdslodge.co.za/', bookingUrl: 'https://book.nightsbridge.com/12292', tier: 'upscale', volumeClass: 'low', region: 'Africa', distribution: 'direct+ota' },

  // ---------------- ROOMRACCOON (agent-blocked exhibit — retained, not excluded) ----------------
  { system: 'roomraccoon', name: 'Glen Hotel', homepageUrl: 'https://glenhotel.co.za/', tier: 'upscale', volumeClass: 'low', region: 'Africa', distribution: 'direct+ota' },
  { system: 'roomraccoon', name: 'Steenhof Suites', homepageUrl: 'https://steenhofsuites.com/', tier: 'upscale', volumeClass: 'low', region: 'Africa', distribution: 'direct+ota' },
  { system: 'roomraccoon', name: 'Miracle Manor', homepageUrl: 'https://www.miraclemanor.com/', tier: 'upscale', volumeClass: 'low', region: 'North America', distribution: 'direct+ota' },
  { system: 'roomraccoon', name: 'Edgartown Commons', homepageUrl: 'https://edgartowncommons.com/', tier: 'midscale', volumeClass: 'low', region: 'North America', distribution: 'direct+ota' },

  // ---------------- MEWS (HIA-relevant, app.mews.com/distributor — clean) ----------------
  { system: 'mews', name: 'MUSA Lago di Como', homepageUrl: 'https://musacomo.com/en/', bookingUrl: 'https://app.mews.com/distributor/c99e4a6b-920b-401c-af99-ae200094de71', tier: 'luxury', volumeClass: 'medium', region: 'Europe', distribution: 'direct+ota' },
  { system: 'mews', name: 'Victoria Palace Hotel', homepageUrl: 'https://victoriapalace.com/en/', bookingUrl: 'https://app.mews.com/distributor/fbb6c2f4-bfff-46b2-a4ce-abb100b80fe5', tier: 'upscale', volumeClass: 'high', region: 'Europe', distribution: 'direct+ota' },
  { system: 'mews', name: "Elmhirst's Resort", homepageUrl: 'https://elmhirst.ca/', bookingUrl: 'https://app.mews.com/distributor/2498d048-7b66-4e46-a563-b26700598ec2', tier: 'upscale', volumeClass: 'medium', region: 'North America', distribution: 'direct+ota' },
  { system: 'mews', name: 'Somewhere Inn Collingwood', homepageUrl: 'https://somewhereinn.ca/collingwood/', bookingUrl: 'https://app.mews.com/distributor/43156a17-4491-458d-8f08-b0c8009b6e0d', tier: 'upscale', volumeClass: 'low', region: 'North America', distribution: 'direct+ota' },
  { system: 'mews', name: 'Sun & Ski Inn', homepageUrl: 'https://sunandskiinn.com/', bookingUrl: 'https://app.mews.com/distributor/a18e5b73-4fe4-468f-8cd7-b17e008232ec', tier: 'midscale', volumeClass: 'low', region: 'North America', distribution: 'direct+ota' },
  { system: 'mews', name: 'Somewhere Inn Calabogie', homepageUrl: 'https://somewhereinn.ca/calabogie/', bookingUrl: 'https://app.mews.com/distributor/b9fa4e7d-bfe5-41d8-ace8-afc100b75af2', tier: 'upscale', volumeClass: 'low', region: 'North America', distribution: 'direct+ota' },

  // ---------------- STAYNTOUCH (HIA-relevant, .ibe.stayntouch.com — clean) ----------------
  { system: 'stayntouch', name: 'Americana Motor Hotel', homepageUrl: 'https://www.americanamotorhotel.com/', bookingUrl: 'https://americanamotorhotel.ibe.stayntouch.com/', tier: 'upscale', volumeClass: 'medium', region: 'North America', distribution: 'direct+ota' },
  { system: 'stayntouch', name: 'The Essex Resort & Spa', homepageUrl: 'https://www.essexresort.com/', bookingUrl: 'https://essexresort.ibe.stayntouch.com/', tier: 'upscale', volumeClass: 'medium', region: 'North America', distribution: 'direct+ota' },
  { system: 'stayntouch', name: 'Hotel Am Parkring', homepageUrl: 'https://www.hotelamparkring.wien/en/index.html', bookingUrl: 'https://hotelamparkring.ibe.stayntouch.com/?lang=en', tier: 'upscale', volumeClass: 'medium', region: 'Europe', distribution: 'direct+ota' },
  { system: 'stayntouch', name: 'Switzerland Inn', homepageUrl: 'https://www.switzerlandinn.com/', bookingUrl: 'https://switzerlandinn.ibe.stayntouch.com/', tier: 'midscale', volumeClass: 'low', region: 'North America', distribution: 'direct+ota' },
  { system: 'stayntouch', name: 'Hotel 1620 Plymouth Harbor', homepageUrl: 'https://www.hotel1620.com/', bookingUrl: 'https://hotel1620.ibe.stayntouch.com/', tier: 'midscale', volumeClass: 'low', region: 'North America', distribution: 'direct+ota' },
  { system: 'stayntouch', name: 'Casablanca Oceanside Inn', homepageUrl: 'https://casablancaoceansideinn.com/', bookingUrl: 'https://casablancaoceansideinn.ibe.stayntouch.com/', tier: 'budget', volumeClass: 'low', region: 'North America', distribution: 'direct+ota' },

  // ---------------- OPERA-ecosystem (no pure OPERA booking engine — CRS-fronted; itself a finding) ----------------
  { system: 'opera', name: 'Park MGM (OPERA Cloud + Amadeus ACRS)', homepageUrl: 'https://parkmgm.mgmresorts.com/en.html', bookingUrl: 'https://parkmgm.mgmresorts.com/en/hotel.html', tier: 'luxury', volumeClass: 'high', region: 'North America', distribution: 'direct+ota', note: 'OPERA PMS back-office, CRS-fronted booking' },
  { system: 'opera', name: 'Omni Atlanta (OPERA backbone)', homepageUrl: 'https://www.omnihotels.com/', bookingUrl: 'https://www.omnihotels.com/hotels/atlanta-centennial-park', tier: 'upscale', volumeClass: 'high', region: 'North America', distribution: 'direct+ota', note: 'OPERA PMS backbone, proprietary front' },

  // ---------------- OTAs (the direct-vs-OTA argument) ----------------
  { system: 'booking', name: 'Booking.com · Plaza Athénée', homepageUrl: 'https://www.booking.com/', bookingUrl: 'https://www.booking.com/hotel/fr/ha-tel-plaza-atha-c-na-c-e-paris.html', tier: 'luxury', volumeClass: 'high', region: 'Europe', distribution: 'ota' },
  { system: 'airbnb', name: 'Airbnb · Camps Bay villa', homepageUrl: 'https://www.airbnb.com/', bookingUrl: 'https://www.airbnb.com/rooms/31030250', tier: 'luxury', volumeClass: 'high', region: 'Africa', distribution: 'ota' },
  { system: 'expedia', name: 'Expedia · Burj Al Arab', homepageUrl: 'https://www.expedia.com/', bookingUrl: 'https://www.expedia.com/Dubai-Hotels-Burj-Al-Arab-Jumeirah.h527497.Hotel-Information', tier: 'luxury', volumeClass: 'high', region: 'Asia', distribution: 'ota' },
  { system: 'travelstart', name: 'Travelstart · Cape Town search', homepageUrl: 'https://www.travelstart.co.za/', bookingUrl: 'https://www.travelstart.co.za/accommodation/in/cape-town-western-cape-south-africa', tier: 'midscale', volumeClass: 'high', region: 'Africa', distribution: 'ota' },
];

export const VIEWPORTS = {
  desktop: { width: 1920, height: 1080, ua: 'desktop' },
  mobile: { width: 375, height: 667, ua: 'mobile' },
};
