export const CULTURE_MEDIA:Record<string,string[]> = {
 Agar: [
  'Mueller–Hinton agar (MHA)', 'Mueller–Hinton fastidious agar (MH-F)',
  'Nutrient agar (NA)', 'Blood agar (BA)', 'Chocolate agar',
  'MacConkey agar (MAC)', 'Eosin methylene blue agar (EMB)',
  'Xylose lysine deoxycholate agar (XLD)', 'Mannitol salt agar (MSA)',
  'Cetrimide agar', 'Sabouraud dextrose agar (SDA)', 'Thayer–Martin agar',
  'TCBS agar', 'CLED agar', 'Bile esculin agar', 'Baird–Parker agar',
  'Brain heart infusion agar (BHI)', 'Tryptic soy agar (TSA)',
 ],
 Broth: [
  'Cation-adjusted Mueller–Hinton broth (CAMHB)', 'Mueller–Hinton broth (MHB)',
  'Mueller–Hinton fastidious broth (MH-F)', 'Nutrient broth',
  'Brain heart infusion broth (BHI)', 'Tryptic soy broth (TSB)',
  'Sabouraud dextrose broth', 'RPMI 1640 medium',
  'Thioglycollate broth', 'Selenite F broth', 'Tetrathionate broth',
  'Alkaline peptone water (APW)', 'Rappaport–Vassiliadis broth (RV)',
 ],
 'Other medium': ['Löwenstein–Jensen medium (LJ)'],
};
export const MIC_MEDIA_NOTE='For broth or agar dilution MIC, record the exact medium and any supplements from the protocol used. This catalog is for recording and does not confirm method suitability.';
export function validateCultureMedium(p:any):string|null {
 if(!p||typeof p.mediumType!=='string'||!Object.hasOwn(CULTURE_MEDIA,p.mediumType))return 'Select the culture medium type (agar, broth or other medium).';
 if(typeof p.mediumName!=='string'||!p.mediumName.trim()||p.mediumName.length>300)return 'Select or specify the culture medium used.';
 if(p.mediumCustom!==true&&!CULTURE_MEDIA[p.mediumType].includes(p.mediumName))return 'Select a listed medium or use Other / custom.';
 if(p.method==='Disk diffusion'&&p.mediumType==='Broth')return 'Disk diffusion requires solid medium. Review the medium type or assay method.';
 for(const k of ['mediumSupplements','mediumLot'])if(p[k]!=null&&(typeof p[k]!=='string'||p[k].length>500))return 'Medium supplements and lot fields must be text under 500 characters.';
 return null;
}
