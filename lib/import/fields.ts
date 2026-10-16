/**
 * The canonical shape every uploaded file is mapped onto.
 *
 * An operator declares their file's own column names, then says which of theirs supplies each of
 * these. Nothing downstream ever sees a source-specific column name.
 */
export type CanonicalField =
  | "name" | "doingBusinessAs" | "email" | "phone" | "website"
  | "streetAddress" | "addressLine2" | "city" | "county" | "state" | "zipCode"
  | "licenseNumber" | "licenseStatus" | "licenseType" | "pharmacyType"
  | "ownerName" | "picName" | "npi" | "ncpdpId";

export type FieldSpec = {
  field: CanonicalField;
  label: string;
  help: string;
  /** The import cannot proceed unless a column is chosen for this field. */
  required?: boolean;
  /** Strongly advised: the rules below read it, and its absence weakens the result. */
  importance: "required" | "important" | "optional";
  /** Header names seen in real files, used to pre-select a mapping. Lowercased, punctuation-free. */
  aliases: string[];
};

export const FIELDS: FieldSpec[] = [
  { field: "name", label: "Pharmacy name", importance: "required", required: true,
    help: "The legal or trading name. Used for chain detection and for matching against records you already hold.",
    aliases: ["name", "pharmacyname", "facilityname", "businessname", "legalname", "licenseename",
              "entityname", "storename", "organizationname", "providername", "company"] },

  { field: "email", label: "Email address", importance: "required", required: true,
    help: "Mandatory. A file without an email column cannot be imported — outreach is the point of this registry.",
    aliases: ["email", "emailaddress", "email1", "primaryemail", "contactemail", "businessemail",
              "eaddress", "mail", "responsiblepersonemail"] },

  { field: "licenseNumber", label: "Licence number", importance: "important",
    help: "The state licence or permit number. With a state, this is the strongest way to recognise a pharmacy you already have.",
    aliases: ["licensenumber", "license", "licenseno", "licencenumber", "permitnumber", "permitno",
              "licenseid", "registrationnumber", "number"] },

  { field: "licenseStatus", label: "Licence status", importance: "important",
    help: "Active, expired, revoked and so on. A licence that is not open is excluded.",
    aliases: ["licensestatus", "status", "licencestatus", "permitstatus", "statusdescription",
              "licensestatusdescription"] },

  { field: "licenseType", label: "Licence type", importance: "important",
    help: "The permit class. State-specific type exclusions are applied to it, and it feeds chain and institution detection.",
    aliases: ["licensetype", "licencetype", "permittype", "type", "licensetypesubcategory",
              "categoryofpermit", "classification", "pharmacytype"] },

  { field: "state", label: "State", importance: "important",
    help: "Two-letter code or full name. Used for licence identity, for non-resident detection and for verifying one state at a time.",
    aliases: ["state", "st", "statecode", "province", "licensestate", "mailingstate",
              "physicalstate", "stateabbreviation"] },

  { field: "streetAddress", label: "Street address", importance: "important",
    help: "Used for deduplication and for matching against existing records.",
    aliases: ["address", "streetaddress", "address1", "addressline1", "street", "mailingaddress",
              "physicaladdress", "location", "addr1"] },

  { field: "city", label: "City", importance: "important",
    help: "Used for deduplication and shown in the registry.",
    aliases: ["city", "town", "mailingcity", "physicalcity", "citynname"] },

  { field: "zipCode", label: "ZIP code", importance: "important",
    help: "Five digits are enough. Part of the deduplication key.",
    aliases: ["zip", "zipcode", "postalcode", "postcode", "zip5", "mailingzip", "physicalzip"] },

  { field: "phone", label: "Phone", importance: "optional",
    help: "Kept for records that never produce a usable email address.",
    aliases: ["phone", "phonenumber", "telephone", "tel", "businessphone", "contactphone",
              "primaryphone", "phone1"] },

  { field: "doingBusinessAs", label: "Trading name (DBA)", importance: "optional",
    help: "Often where a chain banner appears when the legal name looks independent.",
    aliases: ["dba", "doingbusinessas", "tradename", "tradingname", "alsoknownas", "aka",
              "othername", "dbaname"] },

  { field: "county", label: "County", importance: "optional",
    help: "Some boards flag non-resident licensees here — those are excluded.",
    aliases: ["county", "countyname", "parish"] },

  { field: "addressLine2", label: "Address line 2", importance: "optional",
    help: "Suite or unit.",
    aliases: ["address2", "addressline2", "suite", "unit", "addr2"] },

  { field: "website", label: "Website", importance: "optional",
    help: "No government source publishes this; present only in commercial files.",
    aliases: ["website", "url", "web", "homepage", "site", "websiteaddress"] },

  { field: "ownerName", label: "Owner", importance: "optional",
    help: "Owner or responsible party, where the source names one.",
    aliases: ["owner", "ownername", "responsibleparty", "licensee", "proprietor"] },

  { field: "picName", label: "Pharmacist in charge", importance: "optional",
    help: "The named pharmacist. The best personalisation token this data offers.",
    aliases: ["pic", "picname", "pharmacistincharge", "responsiblepharmacist",
              "responsiblepersonname", "managingpharmacist", "pharmacist"] },

  { field: "pharmacyType", label: "Pharmacy type", importance: "optional",
    help: "Where the source states it separately from the licence type.",
    aliases: ["pharmacytype", "facilitytype", "practicetype", "category", "subcategory"] },

  { field: "npi", label: "NPI", importance: "optional",
    help: "Ten digits. Used to link against NPPES where present.",
    aliases: ["npi", "npinumber", "nationalproviderid", "npi1"] },

  { field: "ncpdpId", label: "NCPDP ID", importance: "optional",
    help: "Seven digits. Present in commercial pharmacy files.",
    aliases: ["ncpdp", "ncpdpid", "nabp", "nabpid", "chaincode"] },
];

export const REQUIRED_FIELDS = FIELDS.filter((f) => f.required).map((f) => f.field);

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Best-guess mapping from a file's own headers to canonical fields, used to pre-fill the form.
 * An exact alias beats a partial one, and no column is ever claimed by two fields.
 */
export function suggestMapping(headers: string[]): Partial<Record<CanonicalField, string>> {
  const out: Partial<Record<CanonicalField, string>> = {};
  const taken = new Set<string>();

  for (const pass of ["exact", "partial"] as const) {
    for (const spec of FIELDS) {
      if (out[spec.field]) continue;
      const hit = headers.find((h) => {
        if (taken.has(h)) return false;
        const k = squash(h);
        if (!k) return false;
        return pass === "exact"
          ? spec.aliases.includes(k)
          : spec.aliases.some((a) => a.length >= 5 && (k.includes(a) || a.includes(k)));
      });
      if (hit) { out[spec.field] = hit; taken.add(hit); }
    }
  }
  return out;
}
