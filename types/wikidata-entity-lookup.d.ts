declare module 'wikidata-entity-lookup' {
  type WikidataCall = (queryString: string) => Promise<
    {
      nameType: string;
      id: string;
      uriForDisplay: string;
      uri: string;
      name: string;
      repository: string;
      originalQueryString: string;
      description: string;
    }[]
  >;
  type URIGetter = (queryString: string) => string;

  interface WikidataLookup {
    findPerson: WikidataCall;
    findPlace: WikidataCall;
    findOrganization: WikidataCall;
    findTitle: WikidataCall;
    findRS: WikidataCall;

    getPersonLookupURI: URIGetter;
    getPlaceLookupURI: URIGetter;
    getOrganizationLookupURI: URIGetter;
    getTitleLookupURI: URIGetter;
    getRSLookupURI: URIGetter;
  }

  const wikidataLookup: WikidataLookup;
  export default wikidataLookup;
}
