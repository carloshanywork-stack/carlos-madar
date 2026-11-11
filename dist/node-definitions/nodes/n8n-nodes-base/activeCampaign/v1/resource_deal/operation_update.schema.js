/**
 * ActiveCampaign Node - Version 1 - Zod Schema
 * Discriminator: resource=deal, operation=update
 *
 * Use .parse() for strict validation or .safeParse() for error handling.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

module.exports = function getSchema({ parameters, z, expressionSchema, stringOrExpression, numberOrExpression, booleanOrExpression, resourceLocatorValueSchema, resourceMapperValueSchema, filterValueSchema, assignmentCollectionValueSchema, iDataObjectSchema }) {

  return z.object({
    parameters: z.object({
      resource: z.literal('deal'),
      operation: z.literal('update'),
      dealId: numberOrExpression.optional(),
      updateFields: z.object({ title: stringOrExpression.optional(), contact: numberOrExpression.optional(), value: numberOrExpression.optional(), currency: z.union([z.literal('eur'), z.literal('usd'), z.literal('gbp'), z.literal('chf'), z.literal('cny'), z.literal(''), z.literal('aed'), z.literal('afn'), z.literal('all'), z.literal('amd'), z.literal('ang'), z.literal('aoa'), z.literal('ars'), z.literal('aud'), z.literal('awg'), z.literal('azn'), z.literal('bam'), z.literal('bbd'), z.literal('bdt'), z.literal('bgn'), z.literal('bhd'), z.literal('bif'), z.literal('bmd'), z.literal('bnd'), z.literal('bob'), z.literal('brl'), z.literal('bsd'), z.literal('btc'), z.literal('btn'), z.literal('bwp'), z.literal('byn'), z.literal('bzd'), z.literal('cad'), z.literal('cdf'), z.literal('clf'), z.literal('clp'), z.literal('cnh'), z.literal('cop'), z.literal('crc'), z.literal('cuc'), z.literal('cup'), z.literal('cve'), z.literal('czk'), z.literal('djf'), z.literal('dkk'), z.literal('dop'), z.literal('dzd'), z.literal('egp'), z.literal('ern'), z.literal('etb'), z.literal('fjd'), z.literal('fkp'), z.literal('gel'), z.literal('ggp'), z.literal('ghs'), z.literal('gip'), z.literal('gmd'), z.literal('gnf'), z.literal('gtq'), z.literal('gyd'), z.literal('hkd'), z.literal('hnl'), z.literal('hrk'), z.literal('htg'), z.literal('huf'), z.literal('idr'), z.literal('ils'), z.literal('imp'), z.literal('inr'), z.literal('iqd'), z.literal('irr'), z.literal('isk'), z.literal('jep'), z.literal('jmd'), z.literal('jod'), z.literal('jpy'), z.literal('kes'), z.literal('kgs'), z.literal('khr'), z.literal('kmf'), z.literal('kpw'), z.literal('krw'), z.literal('kwd'), z.literal('kyd'), z.literal('kzt'), z.literal('lak'), z.literal('lbp'), z.literal('lkr'), z.literal('lrd'), z.literal('lsl'), z.literal('lyd'), z.literal('mad'), z.literal('mdl'), z.literal('mga'), z.literal('mkd'), z.literal('mmk'), z.literal('mnt'), z.literal('mop'), z.literal('mro'), z.literal('mru'), z.literal('mur'), z.literal('mvr'), z.literal('mwk'), z.literal('mxn'), z.literal('myr'), z.literal('mzn'), z.literal('nad'), z.literal('ngn'), z.literal('nio'), z.literal('nok'), z.literal('npr'), z.literal('nzd'), z.literal('omr'), z.literal('pab'), z.literal('pen'), z.literal('pgk'), z.literal('php'), z.literal('pkr'), z.literal('pln'), z.literal('pyg'), z.literal('qar'), z.literal('ron'), z.literal('rsd'), z.literal('rub'), z.literal('rwf'), z.literal('sar'), z.literal('sbd'), z.literal('scr'), z.literal('sdg'), z.literal('sek'), z.literal('sgd'), z.literal('shp'), z.literal('sll'), z.literal('sos'), z.literal('srd'), z.literal('ssp'), z.literal('std'), z.literal('stn'), z.literal('svc'), z.literal('syp'), z.literal('szl'), z.literal('thb'), z.literal('tjs'), z.literal('tmt'), z.literal('tnd'), z.literal('top'), z.literal('try'), z.literal('ttd'), z.literal('twd'), z.literal('tzs'), z.literal('uah'), z.literal('ugx'), z.literal('uyu'), z.literal('uzs'), z.literal('vef'), z.literal('vnd'), z.literal('vuv'), z.literal('wst'), z.literal('xaf'), z.literal('xag'), z.literal('xau'), z.literal('xcd'), z.literal('xdr'), z.literal('xof'), z.literal('xpd'), z.literal('xpf'), z.literal('xpt'), z.literal('yer'), z.literal('zar'), z.literal('zmw'), z.literal('zwl'), expressionSchema]).optional(), description: stringOrExpression.optional(), group: stringOrExpression.optional(), stage: stringOrExpression.optional(), owner: stringOrExpression.optional(), percent: numberOrExpression.optional(), status: numberOrExpression.optional() }).optional(),
    }).optional(),
  });
};