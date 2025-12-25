import { useState, useMemo, useRef, useEffect, Suspense } from 'react';
import { Canvas, useFrame, extend, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Float,
  Stars,
  Sparkles,
  useTexture
} from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MathUtils } from 'three';
import * as random from 'maath/random';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

// --- Danh sách 15 ảnh ---
const TOTAL_NUMBERED_PHOTOS = 15;
const bodyPhotoPaths = Array.from({ length: TOTAL_NUMBERED_PHOTOS }, (_, i) => `/photos/${i + 1}.jpg`);

// --- Cấu hình (Warm & Cozy) ---
const CONFIG = {
  colors: {
    emerald: '#004225',    // Xanh đậm chủ đạo
    gold: '#FFD700',       // Vàng kim loại
    warmWhite: '#FFF8E1',  // Trắng ấm
    // Bảng màu đèn Retro/Vintage
    lights: ['#FF5252', '#FFD740', '#69F0AE', '#40C4FF', '#FF6E40'],
    borders: ['#FFF8E1', '#FFE0B2', '#F8BBD0', '#DCEDC8', '#B3E5FC'],
    giftColors: ['#D32F2F', '#FFD700', '#1976D2', '#2E7D32'],
  },
  counts: {
    foliage: 12000,   
    ornaments: 150,
    elements: 120,
    lights: 300,
    snowflakes: 800
  },
  tree: { height: 24, width: 11 }, 
  photos: { body: bodyPhotoPaths },
  snow: { fallSpeed: 0.3, swayAmount: 0.8 }
};

// --- Shader Material (Foliage: Soft Glow & Wind) ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(CONFIG.colors.emerald), uProgress: 0 },
  // Vertex Shader
  `uniform float uTime; uniform float uProgress; 
  attribute vec3 aTargetPos; attribute float aRandom; attribute vec3 aColor;
  varying vec2 vUv; varying float vMix; varying vec3 vColor;
  
  float cubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0; }
  
  void main() {
    vUv = uv; vColor = aColor;
    // Hiệu ứng gió (Wind)
    vec3 noise = vec3(
      sin(uTime * 1.5 + position.x * 0.5), 
      cos(uTime * 1.0 + position.y * 0.5), 
      sin(uTime * 1.5 + position.z * 0.5)
    ) * 0.2;
    
    float t = cubicInOut(uProgress);
    vec3 finalPos = mix(position, aTargetPos + noise, t);
    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    
    // Kích thước điểm thay đổi theo độ sâu
    gl_PointSize = (90.0 * (0.6 + aRandom * 0.4)) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    vMix = t;
  }`,
  // Fragment Shader (Soft Circle)
  `uniform vec3 uColor; varying float vMix; varying vec3 vColor;
  void main() {
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    if (dist > 0.5) discard;
    
    // Làm mờ viền hạt
    float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
    
    // Màu sắc rực rỡ hơn khi cây Formed
    vec3 finalColor = mix(vColor, vColor * 1.5, vMix); 
    gl_FragColor = vec4(finalColor, alpha * 0.95);
  }`
);
extend({ FoliageMaterial });

// --- Component: Foliage (Spiral Algorithm) ---
const Foliage = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const materialRef = useRef<any>(null);
  
  const { positions, targetPositions, randoms, colors } = useMemo(() => {
    const count = CONFIG.counts.foliage;
    const positions = new Float32Array(count * 3);
    const targetPositions = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    // Màu gradient
    const colorInside = new THREE.Color('#002211'); 
    const colorOutside = new THREE.Color('#2E7D32'); 
    const colorTip = new THREE.Color('#66BB6A');    

    const goldenAngle = Math.PI * (3 - Math.sqrt(5)); 

    for (let i = 0; i < count; i++) {
      // 1. Vị trí CHAOS
      const rChaos = 40 + Math.random() * 40;
      const thetaChaos = Math.random() * Math.PI * 2;
      const phiChaos = Math.acos(2 * Math.random() - 1);
      positions[i*3] = rChaos * Math.sin(phiChaos) * Math.cos(thetaChaos);
      positions[i*3+1] = rChaos * Math.sin(phiChaos) * Math.sin(thetaChaos);
      positions[i*3+2] = rChaos * Math.cos(phiChaos);

      // 2. Vị trí FORMED (Xoắn ốc)
      const y = CONFIG.tree.height * (i / count) - CONFIG.tree.height / 2;
      const radiusAtY = (CONFIG.tree.width * (1 - (i / count))); 
      const theta = i * goldenAngle; 
      
      const r = radiusAtY * Math.sqrt(Math.random()); 
      
      const jitter = 0.4;
      targetPositions[i*3] = r * Math.cos(theta) + (Math.random()-0.5)*jitter;
      targetPositions[i*3+1] = y + (Math.random()-0.5)*jitter;
      targetPositions[i*3+2] = r * Math.sin(theta) + (Math.random()-0.5)*jitter;

      randoms[i] = Math.random();

      // Phối màu 3D
      const distFromCenter = r / CONFIG.tree.width;
      let finalColor = colorInside.clone();
      if (distFromCenter > 0.3) finalColor.lerp(colorOutside, 0.6);
      if (distFromCenter > 0.7) finalColor.lerp(colorTip, 0.8);
      if (Math.random() < 0.05) finalColor.lerp(new THREE.Color(CONFIG.colors.gold), 0.6);

      colors[i*3] = finalColor.r;
      colors[i*3+1] = finalColor.g;
      colors[i*3+2] = finalColor.b;
    }
    return { positions, targetPositions, randoms, colors };
  }, []);

  useFrame((rootState, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = rootState.clock.elapsedTime;
      const targetProgress = state === 'FORMED' ? 1 : 0;
      materialRef.current.uProgress = MathUtils.damp(materialRef.current.uProgress, targetProgress, 1.2, delta);
    }
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aTargetPos" args={[targetPositions, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
        <bufferAttribute attach="attributes-aColor" args={[colors, 3]} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <foliageMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.NormalBlending} />
    </points>
  );
};

// --- Component: Snowflakes ---
const Snowflakes = () => {
  const count = CONFIG.counts.snowflakes;
  const meshRef = useRef<THREE.Points>(null);
  
  const { positions, velocities, sway } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count);
    const sway = new Float32Array(count);
    
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 80;
      positions[i * 3 + 1] = Math.random() * 60 - 10;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
      velocities[i] = 0.2 + Math.random() * 0.3;
      sway[i] = Math.random() * Math.PI * 2;
    }
    return { positions, velocities, sway };
  }, []);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const posArray = meshRef.current.geometry.attributes.position.array as Float32Array;
    
    for (let i = 0; i < count; i++) {
      posArray[i * 3 + 1] -= velocities[i] * CONFIG.snow.fallSpeed;
      posArray[i * 3] += Math.sin(state.clock.elapsedTime + sway[i]) * CONFIG.snow.swayAmount * delta;
      
      if (posArray[i * 3 + 1] < -30) {
        posArray[i * 3 + 1] = 30;
        posArray[i * 3] = (Math.random() - 0.5) * 80;
        posArray[i * 3 + 2] = (Math.random() - 0.5) * 80;
      }
    }
    meshRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.3}
        color="#ffffff"
        transparent
        opacity={0.8}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
};

// --- Component: Photo Ornaments (FIXED: CENTER POSITION & SMOOTHNESS) ---
const PhotoOrnaments = ({ 
  state, 
  heroPhotoIndex, 
  onPhotoClick 
}: { 
  state: 'CHAOS' | 'FORMED'; 
  heroPhotoIndex: number | null;
  onPhotoClick: (index: number) => void;
}) => {
  const textures = useTexture(CONFIG.photos.body);
  const count = CONFIG.counts.ornaments;
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree(); // Lấy camera để tính vị trí chuẩn

  const borderGeometry = useMemo(() => new THREE.PlaneGeometry(1.2, 1.5), []);
  const photoGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => {
      // Vị trí Chaos
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*70, (Math.random()-0.5)*70, (Math.random()-0.5)*70);
      
      // Vị trí Formed
      const h = CONFIG.tree.height;
      const y = (Math.random() * h) - (h / 2);
      const rAtY = CONFIG.tree.width * (1 - (y + h/2)/h) + 1.2; 
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(rAtY * Math.cos(theta), y, rAtY * Math.sin(theta));

      const isBig = Math.random() < 0.2;
      const baseScale = isBig ? 1.5 : 0.8 + Math.random() * 0.4;
      const weight = 0.8 + Math.random() * 1.2; // Trọng lượng riêng để bay lệch nhau
      const borderColor = CONFIG.colors.borders[Math.floor(Math.random() * CONFIG.colors.borders.length)];

      const rotationSpeed = {
        x: (Math.random() - 0.5) * 1.0,
        y: (Math.random() - 0.5) * 1.0,
        z: (Math.random() - 0.5) * 1.0
      };
      const chaosRotation = new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);

      return {
        chaosPos, targetPos, scale: baseScale, weight,
        textureIndex: i % textures.length,
        borderColor,
        currentPos: chaosPos.clone(),
        chaosRotation,
        rotationSpeed,
        wobbleOffset: Math.random() * 10,
        wobbleSpeed: 0.5 + Math.random() * 0.5
      };
    });
  }, [textures, count]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;

    groupRef.current.children.forEach((group, i) => {
      const objData = data[i];
      let targetPos, targetScale;

      // --- LOGIC HERO MODE (QUAN TRỌNG: SỬA LỖI VỊ TRÍ) ---
      if (heroPhotoIndex === i) {
        // Tạo một vector offset: nằm trước mặt camera 25 đơn vị (Z = -25 trong local space)
        const offset = new THREE.Vector3(0, 0, -25);
        // Xoay offset theo hướng camera đang nhìn
        offset.applyQuaternion(camera.quaternion);
        // Cộng vào vị trí hiện tại của camera
        targetPos = camera.position.clone().add(offset);
        
        targetScale = 8; // Zoom to
        
        // Luôn xoay mặt ảnh về phía camera
        group.lookAt(camera.position); 
      } 
      // --- LOGIC BÌNH THƯỜNG ---
      else if (isFormed) {
        targetPos = objData.targetPos;
        targetScale = objData.scale;
      } else {
        targetPos = objData.chaosPos;
        targetScale = objData.scale;
      }

      // --- ĐỘ MƯỢT (LERP) ---
      // Nếu đang zoom thì bay nhanh hơn (3.0), bình thường thì bay chậm (1.0) cho mượt
      const lerpSpeed = heroPhotoIndex === i ? 3.0 : (isFormed ? 1.0 * objData.weight : 0.8);
      objData.currentPos.lerp(targetPos, delta * lerpSpeed);
      group.position.copy(objData.currentPos);

      // Scale animation
      const currentScale = group.scale.x;
      const newScale = MathUtils.lerp(currentScale, targetScale, delta * 2.5);
      group.scale.set(newScale, newScale, newScale);

      // Rotation logic (Chỉ xoay khi không phải là ảnh Hero)
      if (heroPhotoIndex !== i) {
        if (isFormed) {
          const targetLookPos = new THREE.Vector3(group.position.x * 2, group.position.y, group.position.z * 2);
          group.lookAt(targetLookPos);
          const wobbleX = Math.sin(time * objData.wobbleSpeed + objData.wobbleOffset) * 0.05;
          const wobbleZ = Math.cos(time * objData.wobbleSpeed * 0.8 + objData.wobbleOffset) * 0.05;
          group.rotation.x += wobbleX;
          group.rotation.z += wobbleZ;
        } else {
          group.rotation.x += delta * objData.rotationSpeed.x;
          group.rotation.y += delta * objData.rotationSpeed.y;
          group.rotation.z += delta * objData.rotationSpeed.z;
        }
      }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <group 
          key={i} 
          scale={[obj.scale, obj.scale, obj.scale]} 
          rotation={state === 'CHAOS' ? obj.chaosRotation : [0,0,0]}
          // Cho phép click mọi lúc
          onPointerDown={(e) => { e.stopPropagation(); onPhotoClick(i); }} 
          onPointerOver={() => { if (heroPhotoIndex === null) document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { document.body.style.cursor = 'default'; }}
        >
          {/* Mặt trước */}
          <group position={[0, 0, 0.015]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial
                map={textures[obj.textureIndex]}
                roughness={0.4} metalness={0}
                emissive={CONFIG.colors.warmWhite} 
                emissiveMap={textures[obj.textureIndex]} 
                emissiveIntensity={heroPhotoIndex === i ? 1.0 : 0} 
                side={THREE.FrontSide}
              />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial 
                color={obj.borderColor} 
                roughness={0.9} metalness={0} side={THREE.FrontSide}
                emissive={heroPhotoIndex === i ? obj.borderColor : '#000000'}
                emissiveIntensity={heroPhotoIndex === i ? 0.4 : 0}
              />
            </mesh>
          </group>
          {/* Mặt sau */}
          <group position={[0, 0, -0.015]} rotation={[0, Math.PI, 0]}>
            <mesh geometry={borderGeometry}>
               <meshStandardMaterial color={obj.borderColor} roughness={0.9} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
};

// --- Component: Christmas Elements ---
const ChristmasElements = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.elements;
  const groupRef = useRef<THREE.Group>(null);

  const boxGeometry = useMemo(() => new THREE.BoxGeometry(0.8, 0.8, 0.8), []);
  const sphereGeometry = useMemo(() => new THREE.SphereGeometry(0.5, 16, 16), []);
  const caneGeometry = useMemo(() => new THREE.CylinderGeometry(0.15, 0.15, 1.2, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height;
      const y = (Math.random() * h) - (h / 2);
      
      const rAtY = CONFIG.tree.width * (1 - (y + h/2)/h) * 0.9;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(rAtY * Math.cos(theta), y, rAtY * Math.sin(theta));

      const type = Math.floor(Math.random() * 3);
      let color; let scale = 1;
      if (type === 0) { color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; scale = 0.8 + Math.random() * 0.4; }
      else if (type === 1) { color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; scale = 0.6 + Math.random() * 0.4; }
      else { color = Math.random() > 0.5 ? CONFIG.colors.red : CONFIG.colors.white; scale = 0.7 + Math.random() * 0.3; }

      const rotationSpeed = { x: (Math.random()-0.5)*2.0, y: (Math.random()-0.5)*2.0, z: (Math.random()-0.5)*2.0 };
      return { type, chaosPos, targetPos, color, scale, currentPos: chaosPos.clone(), chaosRotation: new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI), rotationSpeed };
    });
  }, [boxGeometry, sphereGeometry, caneGeometry]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    groupRef.current.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh;
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 1.5);
      mesh.position.copy(objData.currentPos);
      mesh.rotation.x += delta * objData.rotationSpeed.x; mesh.rotation.y += delta * objData.rotationSpeed.y; mesh.rotation.z += delta * objData.rotationSpeed.z;
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => {
        let geometry; if (obj.type === 0) geometry = boxGeometry; else if (obj.type === 1) geometry = sphereGeometry; else geometry = caneGeometry;
        return ( <mesh key={i} scale={[obj.scale, obj.scale, obj.scale]} geometry={geometry} rotation={obj.chaosRotation}>
          <meshStandardMaterial color={obj.color} roughness={0.3} metalness={0.4} emissive={obj.color} emissiveIntensity={0.2} />
        </mesh> )})}
    </group>
  );
};

// --- Component: Fairy Lights ---
const FairyLights = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.lights;
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.35, 8, 8), []); 

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2); 
      
      const rAtY = CONFIG.tree.width * (1 - (y + h/2)/h) + 0.5;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(rAtY * Math.cos(theta), y, rAtY * Math.sin(theta));
      
      const color = new THREE.Color(CONFIG.colors.lights[Math.floor(Math.random() * CONFIG.colors.lights.length)]);
      const speed = 2 + Math.random() * 3;
      const pulseOffset = Math.random() * 100;
      return { chaosPos, targetPos, color, speed, currentPos: chaosPos.clone(), timeOffset: Math.random() * 100, pulseOffset };
    });
  }, []);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 2.0);
      const mesh = child as THREE.Mesh;
      mesh.position.copy(objData.currentPos);
      
      if (mesh.material) {
        const intensity = (Math.sin(time * objData.speed + objData.pulseOffset) + 1.0); 
        (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = isFormed ? intensity * 2.5 : 0; 
      }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => ( <mesh key={i} geometry={geometry}>
          <meshStandardMaterial color={obj.color} emissive={obj.color} emissiveIntensity={0} toneMapped={false} />
        </mesh> ))}
    </group>
  );
};

// --- Component: Top Star ---
const TopStar = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const groupRef = useRef<THREE.Group>(null);
  return (
    <group ref={groupRef} position={[0, CONFIG.tree.height / 2 + 1.5, 0]}>
       <mesh>
          <icosahedronGeometry args={[1.5, 0]} />
          <meshStandardMaterial color={CONFIG.colors.gold} emissive={CONFIG.colors.gold} emissiveIntensity={3} />
       </mesh>
       <pointLight color={CONFIG.colors.gold} intensity={60} distance={25} />
       <Sparkles count={50} scale={6} size={5} speed={0.4} opacity={1} color="#FFF" />
    </group>
  );
};

// --- Main Scene Experience ---
const Experience = ({ 
  sceneState, 
  rotationSpeed, 
  heroPhotoIndex,
  onPhotoClick 
}: { 
  sceneState: 'CHAOS' | 'FORMED'; 
  rotationSpeed: number;
  heroPhotoIndex: number | null;
  onPhotoClick: (index: number) => void;
}) => {
  const controlsRef = useRef<any>(null);
  useFrame((state, delta) => {
    if (controlsRef.current) {
      if (heroPhotoIndex === null) {
         controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + rotationSpeed);
      }
      controlsRef.current.update();

      // Camera Zoom nhẹ hiệu ứng
      const targetZ = heroPhotoIndex !== null ? 40 : 60;
      state.camera.position.z = MathUtils.lerp(state.camera.position.z, targetZ, delta * 1.5);
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 8, 60]} fov={45} />
      <OrbitControls 
        ref={controlsRef} 
        enablePan={false} 
        enableZoom={true} 
        minDistance={30} 
        maxDistance={120} 
        autoRotate={rotationSpeed === 0 && sceneState === 'FORMED' && heroPhotoIndex === null} 
        autoRotateSpeed={0.5} 
        maxPolarAngle={Math.PI / 1.7} 
      />

      <color attach="background" args={['#050505']} />
      <Stars radius={100} depth={50} count={3000} factor={4} saturation={0} fade speed={1} />
      <Environment preset="night" background={false} />

      <ambientLight intensity={0.3} color="#001100" />
      <pointLight position={[30, 20, 30]} intensity={80} color={CONFIG.colors.warmWhite} />
      <pointLight position={[-30, 10, -30]} intensity={50} color={CONFIG.colors.gold} />
      
      <group position={[0, -8, 0]}>
        <Foliage state={sceneState} />
        <Snowflakes />
        <Suspense fallback={null}>
           <PhotoOrnaments 
             state={sceneState} 
             heroPhotoIndex={heroPhotoIndex}
             onPhotoClick={onPhotoClick}
           />
           <ChristmasElements state={sceneState} />
           <FairyLights state={sceneState} />
           <TopStar state={sceneState} />
        </Suspense>
        <Sparkles count={500} scale={[60, 40, 60]} size={6} speed={0.5} opacity={0.5} color="#FFF" />
      </group>

      <EffectComposer>
        <Bloom luminanceThreshold={0.5} luminanceSmoothing={0.9} intensity={2.0} radius={0.6} mipmapBlur />
        <Vignette eskil={false} offset={0.1} darkness={1.2} />
      </EffectComposer>
    </>
  );
};

// --- Gesture Controller ---
const GestureController = ({ onGesture, onMove, onStatus, onPinch, debugMode }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let gestureRecognizer: GestureRecognizer;
    let requestRef: number;

    const setup = async () => {
      onStatus("DOWNLOADING AI...");
      try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });
        onStatus("REQUESTING CAMERA...");
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
            onStatus("AI READY: SHOW HAND");
            predictWebcam();
          }
        } else {
            onStatus("ERROR: CAMERA PERMISSION DENIED");
        }
      } catch (err: any) {
        onStatus(`ERROR: ${err.message || 'MODEL FAILED'}`);
      }
    };

    const predictWebcam = () => {
      if (gestureRecognizer && videoRef.current && canvasRef.current) {
        if (videoRef.current.videoWidth > 0) {
            const results = gestureRecognizer.recognizeForVideo(videoRef.current, Date.now());
            const ctx = canvasRef.current.getContext("2d");
            if (ctx && debugMode) {
                ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                canvasRef.current.width = videoRef.current.videoWidth; canvasRef.current.height = videoRef.current.videoHeight;
                if (results.landmarks) for (const landmarks of results.landmarks) {
                        const drawingUtils = new DrawingUtils(ctx);
                        drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: "#FFD700", lineWidth: 2 });
                        drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1 });
                }
            } else if (ctx && !debugMode) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

            if (results.gestures.length > 0) {
              const name = results.gestures[0][0].categoryName; const score = results.gestures[0][0].score;
              if (score > 0.4) {
                 if (name === "Open_Palm") onGesture("CHAOS"); 
                 if (name === "Closed_Fist") onGesture("FORMED");
                 
                 // Phát hiện Pinch
                 if (results.landmarks.length > 0) {
                   const landmarks = results.landmarks[0];
                   const thumb = landmarks[4];
                   const index = landmarks[8];
                   const distance = Math.sqrt(
                     Math.pow(thumb.x - index.x, 2) + 
                     Math.pow(thumb.y - index.y, 2)
                   );
                   if (distance < 0.05) {
                     onPinch(true);
                   } else {
                     onPinch(false);
                   }
                 }
                 
                 if (debugMode) onStatus(`DETECTED: ${name}`);
              }
              if (results.landmarks.length > 0) {
                const speed = (0.5 - results.landmarks[0][0].x) * 0.15;
                onMove(Math.abs(speed) > 0.01 ? speed : 0);
              }
            } else { 
              onMove(0); 
              onPinch(false);
              if (debugMode) onStatus("AI READY: NO HAND"); 
            }
        }
        requestRef = requestAnimationFrame(predictWebcam);
      }
    };
    setup();
    return () => cancelAnimationFrame(requestRef);
  }, [onGesture, onMove, onStatus, onPinch, debugMode]);

  return (
    <>
      <video ref={videoRef} style={{ opacity: debugMode ? 0.6 : 0, position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', zIndex: debugMode ? 100 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} playsInline muted autoPlay />
      <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', height: debugMode ? 'auto' : '1px', zIndex: debugMode ? 101 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} />
    </>
  );
};

// --- App Entry (Logic Pinch cập nhật) ---
export default function GrandTreeApp() {
  const [sceneState, setSceneState] = useState<'CHAOS' | 'FORMED'>('CHAOS');
  const [rotationSpeed, setRotationSpeed] = useState(0);
  const [aiStatus, setAiStatus] = useState("INITIALIZING...");
  const [debugMode, setDebugMode] = useState(false);
  const [heroPhotoIndex, setHeroPhotoIndex] = useState<number | null>(null);
  const [isPinching, setIsPinching] = useState(false);

  // --- LOGIC PINCH MỚI (Cho phép Pinch ở mọi chế độ) ---
  useEffect(() => {
    // Nếu đang chụm tay và chưa có ảnh -> Chọn random
    if (isPinching && heroPhotoIndex === null) {
      const randomIndex = Math.floor(Math.random() * CONFIG.counts.ornaments);
      setHeroPhotoIndex(randomIndex);
    } 
    // Nếu thả tay và đang xem ảnh -> Trả ảnh về
    else if (!isPinching && heroPhotoIndex !== null) {
      setHeroPhotoIndex(null);
    }
  }, [isPinching, heroPhotoIndex]); // Bỏ sceneState khỏi dependency

  const handlePhotoClick = (index: number) => {
    // Cho phép click chuột mọi lúc
    setHeroPhotoIndex(heroPhotoIndex === index ? null : index);
  };

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
        <Canvas dpr={[1, 1.5]} gl={{ toneMapping: THREE.ACESFilmicToneMapping, antialias: true }} shadows>
            <Experience 
              sceneState={sceneState} 
              rotationSpeed={rotationSpeed}
              heroPhotoIndex={heroPhotoIndex}
              onPhotoClick={handlePhotoClick}
            />
        </Canvas>
      </div>
      <GestureController 
        onGesture={setSceneState} 
        onMove={setRotationSpeed} 
        onStatus={setAiStatus} 
        onPinch={setIsPinching}
        debugMode={debugMode} 
      />

      {/* UI - Stats */}
      <div style={{ position: 'absolute', bottom: '30px', left: '40px', color: '#888', zIndex: 10, fontFamily: 'sans-serif', userSelect: 'none' }}>
        <div style={{ marginBottom: '15px' }}>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Memories</p>
          <p style={{ fontSize: '24px', color: '#FFD700', fontWeight: 'bold', margin: 0 }}>
            {CONFIG.counts.ornaments} <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>POLAROIDS</span>
          </p>
        </div>
        <div>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Foliage</p>
          <p style={{ fontSize: '24px', color: '#004225', fontWeight: 'bold', margin: 0 }}>
            {(CONFIG.counts.foliage / 1000).toFixed(0)}K <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>EMERALD NEEDLES</span>
          </p>
        </div>
      </div>

      <div style={{ position: 'absolute', bottom: '30px', right: '40px', zIndex: 10, display: 'flex', gap: '10px' }}>
        <button onClick={() => setDebugMode(!debugMode)} style={{ padding: '12px 15px', backgroundColor: debugMode ? '#FFD700' : 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: debugMode ? '#000' : '#FFD700', fontFamily: 'sans-serif', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           {debugMode ? 'HIDE DEBUG' : '🛠 DEBUG'}
        </button>
        <button onClick={() => setSceneState(s => s === 'CHAOS' ? 'FORMED' : 'CHAOS')} style={{ padding: '12px 30px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255, 215, 0, 0.5)', color: '#FFD700', fontFamily: 'serif', fontSize: '14px', fontWeight: 'bold', letterSpacing: '3px', textTransform: 'uppercase', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           {sceneState === 'CHAOS' ? 'Assemble Tree' : 'Disperse'}
        </button>
      </div>

      <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', color: aiStatus.includes('ERROR') ? '#FF0000' : 'rgba(255, 215, 0, 0.4)', fontSize: '10px', letterSpacing: '2px', zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '4px' }}>
        {aiStatus}
      </div>

      {heroPhotoIndex !== null && (
        <div style={{ position: 'absolute', top: '60px', left: '50%', transform: 'translateX(-50%)', color: '#FFD700', fontSize: '14px', letterSpacing: '3px', zIndex: 10, background: 'rgba(0,0,0,0.7)', padding: '10px 20px', borderRadius: '8px', fontFamily: 'serif', fontWeight: 'bold' }}>
          MEMORY #{heroPhotoIndex + 1}
        </div>
      )}

      {!heroPhotoIndex && (
        <div style={{ position: 'absolute', top: '60px', left: '50%', transform: 'translateX(-50%)', color: 'rgba(255, 215, 0, 0.6)', fontSize: '11px', letterSpacing: '2px', zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '6px 12px', borderRadius: '6px', textAlign: 'center' }}>
          👌 PINCH (ngón cái + trỏ) bất kỳ lúc nào để xem ảnh
        </div>
      )}
    </div>
  );
}