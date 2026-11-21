export function runBarcodeCatalogTests({ assert, query }) {
  const publisher = "95555555-5555-4555-8555-555555555551";
  const member = "95555555-5555-4555-8555-555555555552";
  const as = (user, sql) => query(`set request.jwt.claim.sub = '${user}'; ${sql}`, "authenticated");
  const insert = (user, name, code, shared, unit = "serving") => `
    insert into public.personal_foods(user_id,name,barcode,default_unit,calories,protein,carbs,fat,share_barcode)
    values ('${user}','${name}','${code}','${unit}',125,4,20,3,${shared});
  `;
  query(`insert into auth.users(id) values ('${publisher}'), ('${member}');
    insert into public.barcode_catalog_publisher(user_id) values ('${publisher}');`);
  assert.equal(as(publisher, "select public.can_share_barcodes();"), "t");
  assert.equal(as(member, "select public.can_share_barcodes();"), "f");
  assert.throws(() => as(member, insert(member, "Forged publication", "00480123", true)), /publisher/i);
  assert.throws(() => as(publisher, insert(publisher, "Invalid shared basis", "00480123", true, "ml")), /shareable_barcode/);
  as(publisher, insert(publisher, "TEST DATA one serving", "00480123", true));
  as(publisher, insert(publisher, "Not published", "00480124", false));
  as(member, insert(member, "Account only", "00480123", false));
  assert.equal(as(member, "select serving_grams is null from public.personal_foods where barcode='00480123';"), "t", "existing counts keep an unknown mass");
  for (const grams of ["0", "-35", "10001", "'NaN'", "'Infinity'"]) {
    assert.throws(() => as(publisher, `update public.personal_foods set serving_grams=${grams};`), /personal_food_serving_grams/);
  }
  assert.throws(() => as(publisher, "update public.personal_foods set default_unit='g', serving_grams=35;"), /personal_food_serving_grams/);
  as(publisher, "update public.personal_foods set serving_grams=35.5 where barcode='00480123';");
  as(publisher, "update public.personal_foods set serving_grams=41 where barcode='00480124';");
  assert.equal(as(member, "select serving_grams is null from public.personal_foods where barcode='00480123';"), "t", "a publisher update does not modify another account's same barcode");
  assert.throws(() => as(member, "update public.personal_foods set share_barcode=true"), /publisher/i);
  assert.equal(as(member, "select count(*) from public.personal_foods where share_barcode;"), "0");
  assert.equal(as(member, "select count(*) from public.lookup_shared_barcode('00480124');"), "0");
  assert.equal(as(member, "select count(*) from public.lookup_shared_barcode('0048%');"), "0");
  assert.throws(() => query("select * from public.lookup_shared_barcode('00480123');", "anon"), /permission denied/);
  assert.throws(() => as(member, "select user_id from public.barcode_catalog_publisher;"), /permission denied/);
  const result = JSON.parse(as(member, "select row_to_json(f) from public.lookup_shared_barcode('00480123') f;"));
  assert.deepEqual(result, { name: "TEST DATA one serving", calories: 125, protein: 4, carbs: 20, fat: 3, default_unit: "serving", serving_grams: 35.5 });
  as(publisher, "update public.personal_foods set share_barcode = false where barcode = '00480123';");
  assert.equal(as(member, "select count(*) from public.lookup_shared_barcode('00480123');"), "0");
  as(publisher, "update public.personal_foods set share_barcode = true where barcode = '00480123';");
  query("delete from public.barcode_catalog_publisher;");
  assert.equal(as(member, "select count(*) from public.lookup_shared_barcode('00480123');"), "0");
  console.log("  ✓ private barcode rows, publisher-only exact lookup, per-serving values, revocation and grants");
}
