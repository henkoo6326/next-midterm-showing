/* 실내 재질 디테일(라이트맵 모드 위에 얹는다)
 *
 * 왜: 라이트맵 셰이더 패치(scene.js setupLightmap)는 확산광을 라이트맵(법선과 무관)으로만 그리고, 반사 가림 비율을
 *     '결이 들어간 법선'의 환경 확산으로 나눠 결의 명암을 상쇄한다. GLB 의 grain_normal(512², 세기 0.12~0.24, 2.9~4.6 cm 타일)은
 *     운전석 거리(픽셀당 0.6~1 mm)에서 밉맵 3~4단계로 평균돼 기울기 0.2° 미만이 된다. 그래서 면이 매끈한 플라스틱처럼 보였다.
 *
 * 무엇: 재질 그룹별로 월드 공간 삼면 투영(triplanar) 디테일 텍스처 한 장(RGBA: 노멀 XY / 러프니스 변화 / 알베도 변화)을 붙인다.
 *   - 노멀: 반사(IBL·직접광 스페큘러)에 쓰이고, 라이트맵 확산에는 '주 광원 방향(앞유리 위)' 기준 명암비로 결을 새긴다
 *   - 반사 가림: 환경 확산을 결 없는 거시 법선으로 구해(lights_fragment_maps 를 이 재질에서만 복사·치환) 결이 상쇄되지 않게 한다
 *   - 러프니스·알베도: 텍스처 B/A 채널로 ± 변화. 가죽·원단은 얕은 각도 sheen 을 더한다
 *   텍스처 반복은 실제 m 단위(detail.json tile_m), 세 투영 축마다 회전·오프셋을 달리해 반복 무늬를 숨긴다.
 * 기존 onBeforeCompile(라이트맵 패치)을 먼저 부르고 그 결과에 덧붙인다. customProgramCacheKey 도 앞 키에 이어 붙인다.
 * ?xpdetail=0 이면 아무것도 하지 않는다(비교용). */

const GROUPS = [
  // test: 재질 이름, map: detail 텍스처, tile: 반복 크기(m), normal: 노멀 세기, rough: [기본 러프니스, ±변화], albedo: ±변화,
  // shade: 라이트맵 확산 결 명암 세기, sheen: [세기, 지수], specOcc: 반사 가림 완화(0 = 원래대로, 1 = 가림 없음)
  // macro: [배율, 노멀, 알베도, 러프니스] 같은 텍스처를 배율만큼 크게 한 번 더(주 투영 축 하나) — 운전석 거리에서 보이는 cm 단위 굴곡·얼룩
  { id: 'tpo', test: /^01 ·/, map: 'tpo', tile: 0.032, normal: 0.7, rough: [0.82, 0.08], albedo: 0.14, shade: 0.9, sheen: [0.04, 4], specOcc: 0.15, macro: [9, 0.35, 0.10, 0.06] },
  { id: 'lower', test: /^02 ·/, map: 'stipple', tile: 0.024, normal: 0.6, rough: [0.78, 0.07], albedo: 0.12, shade: 0.8, sheen: [0.0, 4], specOcc: 0.0, macro: [10, 0.2, 0.10, 0.05] },
  { id: 'leather', test: /^03 ·/, map: 'leather', tile: 0.09, normal: 0.9, rough: [0.52, 0.10], albedo: 0.18, shade: 1.0, sheen: [0.06, 4], specOcc: 0.45, macro: [4, 0.35, 0.08, 0.08] },
  { id: 'abs', test: /^04 ·/, map: 'stipple', tile: 0.012, normal: 0.25, rough: [0.48, 0.05], albedo: 0.06, shade: 0.5, sheen: [0.0, 4], specOcc: 0.2, macro: [12, 0.04, 0.05, 0.04] },
  { id: 'satin', test: /^06 ·/, map: 'stipple', tile: 0.008, normal: 0.12, rough: [0.40, 0.04], albedo: 0.04, shade: 0.3, sheen: [0.0, 4], specOcc: 0.3, macro: [12, 0.03, 0.04, 0.04] },
  { id: 'alu', test: /^07 ·/, map: 'hairline', tile: 0.02, normal: 0.35, rough: [0.30, 0.08], albedo: 0.10, shade: 0.3, sheen: [0.0, 4], specOcc: 0.2, macro: [1, 0, 0, 0] },
  { id: 'fabric', test: /^10 ·/, map: 'fabric', tile: 0.2735, normal: 0.8, rough: [0.95, 0.04], albedo: 0.22, shade: 0.9, sheen: [0.28, 2], specOcc: 0.0, macro: [1, 0, 0, 0] },
  { id: 'rubber', test: /^11 ·/, map: 'stipple', tile: 0.04, normal: 0.7, rough: [0.88, 0.06], albedo: 0.10, shade: 0.8, sheen: [0.0, 4], specOcc: 0.0, macro: [6, 0.06, 0.08, 0.04] },
];

const DIR = 'assets/models/detail/';

/* lights_fragment_maps 를 복사해 환경 확산만 결 없는 법선(xpMacroN)으로 구한다(반사 가림 비율이 결을 상쇄하지 않게) */
function patchedLightMaps(THREE) {
  const src = THREE.ShaderChunk.lights_fragment_maps;
  const out = src.replace(/getIBLIrradiance\(\s*geometryNormal\s*\)/, 'getIBLIrradiance( xpMacroN )');
  return out === src ? null : out;
}

const HEADER = /* glsl */`
uniform sampler2D xpTex;
uniform vec4 xpP;      // x: 1/tile(m), y: normal, z: albedo, w: shade
uniform vec4 xpQ;      // x: rough base, y: rough ±, z: sheen, w: sheen exp
uniform float xpOcc;   // 반사 가림 완화
uniform vec4 xpM;      // macro: x 배율, y 노멀, z 알베도, w 러프니스
varying vec3 xpW;
varying vec3 xpWN;
mat2 xpRot( float a ) { float c = cos( a ), s = sin( a ); return mat2( c, -s, s, c ); }
`;

export async function applyMaterialDetail({ THREE, renderer, model, assetUrl }) {
  const Q = new URLSearchParams(location.search);
  if (Q.get('xpdetail') === '0') return null;
  const gain = (k, d) => { const v = parseFloat(Q.get(k)); return Number.isFinite(v) ? v : d; };
  const nGain = gain('xpdn', 1);      // 노멀 세기 배율(검수용)
  const sGain = gain('xpds', 1);      // 확산 결 명암 배율(검수용)

  const meta = await (await fetch(assetUrl(DIR + 'detail.json'))).json();
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const texCache = {};
  const tex = name => texCache[name] ||= loader.loadAsync(assetUrl(DIR + meta.maps[name].file + '?v=' + meta.maps[name].sha)).then(t => {
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.needsUpdate = true;
    return t;
  });
  const lightMaps = patchedLightMaps(THREE);

  const done = new Set();
  const report = { groups: {}, materials: 0, textures: 0, samplesPerFragment: '1~3 triplanar (weight 0 skipped) + 1 macro' };
  const jobs = [];
  model.traverse(o => {
    if (!o.isMesh || /^SCREEN_/.test(o.name)) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m || done.has(m) || !m.isMeshStandardMaterial) continue;
      const g = GROUPS.find(x => x.test.test(m.name || ''));
      if (!g) continue;
      done.add(m);
      jobs.push(tex(g.map).then(t => patch(m, g, t)));
      report.groups[g.id] = (report.groups[g.id] || 0) + 1;
    }
  });

  function patch(m, g, t) {
    // GLB 의 grain_normal 은 이 디테일로 대신한다(샘플 1회 절약)
    m.normalMap = null;
    m.roughness = g.rough[0];
    const uniforms = {
      xpTex: { value: t },
      xpP: { value: new THREE.Vector4(1 / g.tile, g.normal * nGain, g.albedo, g.shade * sGain) },
      xpQ: { value: new THREE.Vector4(g.rough[0], g.rough[1], g.sheen[0], g.sheen[1]) },
      xpOcc: { value: g.specOcc },
      xpM: { value: new THREE.Vector4(g.macro[0], g.macro[1] * nGain, g.macro[2], g.macro[3]) },
    };
    const prev = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = (s, r) => {
      if (prev) prev.call(m, s, r);
      Object.assign(s.uniforms, uniforms);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 xpW;\nvarying vec3 xpWN;')
        .replace('#include <fog_vertex>', `#include <fog_vertex>
          {
            vec4 xpwp = modelMatrix * vec4( transformed, 1.0 );
            xpW = xpwp.xyz;
            xpWN = normalize( mat3( modelMatrix ) * objectNormal );
          }`);
      let f = s.fragmentShader
        .replace('#include <common>', '#include <common>\n' + HEADER)
        // 삼면 투영 샘플(한 장, 세 축). 축마다 회전·오프셋을 달리해 반복을 숨긴다
        .replace('#include <map_fragment>', `
          vec3 xpN0 = normalize( xpWN );
          vec3 xpBw = max( pow( abs( xpN0 ), vec3( 8.0 ) ) - 0.003, 0.0 );   // 좁은 전이대: 대부분의 면은 샘플 1회
          xpBw /= ( xpBw.x + xpBw.y + xpBw.z );
          vec3 xpP3 = xpW * xpP.x;
          vec2 xpUX = xpRot( 0.7 ) * xpP3.zy + vec2( 0.31, 0.17 );
          vec2 xpUY = xpRot( 2.1 ) * xpP3.xz + vec2( 0.63, 0.41 );
          vec2 xpUZ = xpRot( 4.0 ) * xpP3.xy + vec2( 0.13, 0.77 );
          vec4 xpTX = xpBw.x > 0.0 ? texture2D( xpTex, xpUX ) : vec4( 0.5, 0.5, 0.5, 0.5 );
          vec4 xpTY = xpBw.y > 0.0 ? texture2D( xpTex, xpUY ) : vec4( 0.5, 0.5, 0.5, 0.5 );
          vec4 xpTZ = xpBw.z > 0.0 ? texture2D( xpTex, xpUZ ) : vec4( 0.5, 0.5, 0.5, 0.5 );
          vec4 xpT = xpTX * xpBw.x + xpTY * xpBw.y + xpTZ * xpBw.z;
          // whiteout 블렌드(월드 공간 디테일 법선). 회전한 투영이라 xy 를 같은 각도로 되돌린다
          vec2 xpNX = ( xpTX.rg * 2.0 - 1.0 ) * xpP.y * xpRot( 0.7 );
          vec2 xpNY = ( xpTY.rg * 2.0 - 1.0 ) * xpP.y * xpRot( 2.1 );
          vec2 xpNZ = ( xpTZ.rg * 2.0 - 1.0 ) * xpP.y * xpRot( 4.0 );
          vec3 xpDX = vec3( xpNX + xpN0.zy, abs( xpN0.x ) );
          vec3 xpDY = vec3( xpNY + xpN0.xz, abs( xpN0.y ) );
          vec3 xpDZ = vec3( xpNZ + xpN0.xy, abs( xpN0.z ) );
          vec3 xpDN = normalize(
            vec3( xpDX.z * sign( xpN0.x ), xpDX.y, xpDX.x ) * xpBw.x +
            vec3( xpDY.x, xpDY.z * sign( xpN0.y ), xpDY.y ) * xpBw.y +
            vec3( xpDZ.x, xpDZ.y, xpDZ.z * sign( xpN0.z ) ) * xpBw.z );
          // macro: 주 투영 축 하나에서 같은 텍스처를 크게(샘플 1회). 낮은 세기라 축 경계 이음매는 드러나지 않는다
          if ( xpM.y + xpM.z + xpM.w > 0.0 ) {
            vec3 xpA = abs( xpN0 );
            vec2 xpUM = ( xpA.x > xpA.y && xpA.x > xpA.z ) ? xpP3.zy : ( xpA.y > xpA.z ? xpP3.xz : xpP3.xy );
            vec4 xpTM = texture2D( xpTex, xpRot( 1.3 ) * xpUM / xpM.x + vec2( 0.37, 0.59 ), 3.5 );   // 밉 바이어스: 날카로운 골 대신 부드러운 굴곡만
            vec2 xpNM = ( xpTM.rg * 2.0 - 1.0 ) * xpM.y * xpRot( 1.3 );
            vec3 xpTt = normalize( cross( xpN0, abs( xpN0.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 ) ) );
            vec3 xpTb = cross( xpN0, xpTt );
            xpDN = normalize( xpDN + xpTt * xpNM.x + xpTb * xpNM.y );
            xpT.b = clamp( xpT.b + xpM.w * ( xpTM.b * 2.0 - 1.0 ) / max( 2.0 * xpQ.y, 1e-3 ), 0.0, 1.0 );
            xpT.a = clamp( xpT.a + xpM.z / max( xpP.z, 1e-3 ) * ( xpTM.a - 0.5 ), 0.0, 1.0 );
          }
          // 결이 픽셀보다 작아지면(밉맵으로 평균) 그만큼 거칠게(Toksvig 근사)
          float xpFoot = log2( max( length( fwidth( xpP3 ) ) * 1024.0, 1.0 ) );
          float xpAA = 0.025 * xpP.y * clamp( xpFoot - 1.0, 0.0, 4.0 );
          #include <map_fragment>
          diffuseColor.rgb *= 1.0 + xpP.z * ( xpT.a * 2.0 - 1.0 );`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = clamp( xpQ.x + xpQ.y * ( xpT.b * 2.0 - 1.0 ) + xpAA, 0.08, 1.0 );`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec3 xpMacroN = normal;
          normal = normalize( normal + ( viewMatrix * vec4( xpDN - xpN0, 0.0 ) ).xyz );`);
      if (lightMaps) f = f.replace('#include <lights_fragment_maps>', lightMaps);
      f = f.replace('#include <lights_fragment_end>', `
          #if defined( USE_LIGHTMAP )
          {
            // 라이트맵 확산에 결 명암: 주 광원(앞유리 위쪽) 방향으로 디테일 법선이 기운 만큼
            vec3 xpL = normalize( vec3( 0.0, 0.8, -0.6 ) );
            float xpS = 1.0 + xpP.w * ( dot( xpDN, xpL ) - dot( xpN0, xpL ) );
            irradiance *= clamp( xpS, 0.55, 1.6 );
            #if defined( USE_ENVMAP ) && defined( STANDARD )
              // 반사 가림 완화(가죽·새틴은 약한 하이라이트 허용)
              if ( xpOcc > 0.0 ) {
                vec3 xpLum = vec3( 0.2126, 0.7152, 0.0722 );
                float xpO = clamp( dot( lightMapIrradiance, xpLum ) / max( dot( getIBLIrradiance( xpMacroN ), xpLum ) / max( envMapIntensity, 1e-4 ), 1e-4 ), 0.0, 1.0 );
                radiance = mix( radiance, radiance / max( xpO, 0.25 ), xpOcc );
              }
            #endif
          }
          #endif
          #include <lights_fragment_end>
          {
            // 얕은 각도 sheen(원단 보풀·가죽 윤): 확산 조도 × 그레이징 항
            float xpNv = saturate( dot( normal, geometryViewDir ) );
            reflectedLight.indirectDiffuse += irradiance * RECIPROCAL_PI * xpQ.z * pow( 1.0 - xpNv, xpQ.w ) * ( 0.6 + 0.8 * xpT.a );
          }`);
      s.fragmentShader = f;
    };
    m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|xp-detail-v2';
    m.needsUpdate = true;
    report.materials++;
  }

  await Promise.all(jobs);
  report.textures = Object.keys(texCache).length;
  report.patchedLightMaps = !!lightMaps;
  return { report, groups: GROUPS.map(g => g.id) };
}
