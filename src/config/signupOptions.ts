/**
 * Option lists for the signup form. Values are stored in Supabase signup
 * user metadata (raw_user_meta_data); heard_about_us is also copied into
 * profiles.heard_about_us by the handle_new_user trigger. No migration needed.
 */

/** Where did you hear about TaskPulse? Stored as stable lowercase values. */
export const HEARD_ABOUT_OPTIONS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'friend', label: 'A friend' },
  { id: 'discord', label: 'Discord' },
  { id: 'other', label: 'Other' },
] as const;
export type HeardAboutId = (typeof HEARD_ABOUT_OPTIONS)[number]['id'];

/** 36 states + FCT. */
export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta',
  'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT (Abuja)', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina',
  'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers',
  'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
] as const;

export const STUDY_LEVELS = ['100L', '200L', '300L', '400L', '500L', 'Postgraduate', 'Graduate'] as const;

export const OTHER_SCHOOL = 'Other';

/** Short curated list of major Nigerian universities and polytechnics. `keywords` help search (abbreviations). */
export const SCHOOLS: { name: string; keywords?: string }[] = [
  { name: 'University of Lagos', keywords: 'UNILAG Akoka' },
  { name: 'University of Ibadan', keywords: 'UI' },
  { name: 'Obafemi Awolowo University', keywords: 'OAU Ife' },
  { name: 'University of Nigeria, Nsukka', keywords: 'UNN' },
  { name: 'Ahmadu Bello University', keywords: 'ABU Zaria' },
  { name: 'University of Benin', keywords: 'UNIBEN' },
  { name: 'University of Ilorin', keywords: 'UNILORIN' },
  { name: 'Lagos State University', keywords: 'LASU' },
  { name: 'Covenant University', keywords: 'CU Ota' },
  { name: 'Babcock University', keywords: 'Ilishan' },
  { name: 'Bingham University', keywords: 'Karu' },
  { name: 'Federal University of Technology, Akure', keywords: 'FUTA' },
  { name: 'Federal University of Technology, Owerri', keywords: 'FUTO' },
  { name: 'Federal University of Technology, Minna', keywords: 'FUTMINNA FUT Minna' },
  { name: 'Yaba College of Technology', keywords: 'YABATECH Yabatech' },
  { name: 'University of Abuja', keywords: 'UNIABUJA' },
  { name: 'University of Port Harcourt', keywords: 'UNIPORT' },
  { name: 'University of Calabar', keywords: 'UNICAL' },
  { name: 'University of Uyo', keywords: 'UNIUYO' },
  { name: 'University of Jos', keywords: 'UNIJOS' },
  { name: 'University of Maiduguri', keywords: 'UNIMAID' },
  { name: 'Bayero University Kano', keywords: 'BUK' },
  { name: 'Nnamdi Azikiwe University', keywords: 'UNIZIK Awka' },
  { name: 'Rivers State University', keywords: 'RSU' },
  { name: 'Delta State University', keywords: 'DELSU Abraka' },
  { name: 'Ekiti State University', keywords: 'EKSU' },
  { name: 'Olabisi Onabanjo University', keywords: 'OOU Ago-Iwoye' },
  { name: 'Ladoke Akintola University of Technology', keywords: 'LAUTECH Ogbomoso' },
  { name: 'Federal University of Agriculture, Abeokuta', keywords: 'FUNAAB' },
  { name: 'Lagos State University of Science and Technology', keywords: 'LASUSTECH LASPOTECH Ikorodu' },
  { name: 'Ambrose Alli University', keywords: 'AAU Ekpoma' },
  { name: 'Afe Babalola University', keywords: 'ABUAD Ado-Ekiti' },
  { name: 'Pan-Atlantic University', keywords: 'PAU Lekki' },
  { name: 'American University of Nigeria', keywords: 'AUN Yola' },
  { name: 'Landmark University', keywords: 'LMU Omu-Aran' },
  { name: 'Redeemer\'s University', keywords: 'RUN Ede' },
  { name: 'Nile University of Nigeria', keywords: 'Abuja' },
  { name: 'Baze University', keywords: 'Abuja' },
  { name: 'Veritas University', keywords: 'Abuja' },
  { name: 'Federal Polytechnic Nekede', keywords: 'Owerri' },
  { name: 'Federal Polytechnic Ilaro', keywords: '' },
  { name: 'Federal Polytechnic Bida', keywords: '' },
  { name: 'Kaduna Polytechnic', keywords: 'KADPOLY' },
  { name: 'The Polytechnic, Ibadan', keywords: 'POLY Ibadan' },
  { name: 'Auchi Polytechnic', keywords: '' },
  { name: 'Institute of Management and Technology, Enugu', keywords: 'IMT' },
  { name: 'Moshood Abiola Polytechnic', keywords: 'MAPOLY Abeokuta' },
  { name: 'National Open University of Nigeria', keywords: 'NOUN' },
];
