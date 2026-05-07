import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getSocket } from '../lib/socket';
import { listZones, type ApiZoneAssignment } from '../lib/api';

export interface UseZoneAssignmentsResult {
  assignmentsByZoneId: Map<string, ApiZoneAssignment[]>;
  myAssignedZoneIds: string[];
  refetch: () => Promise<void>;
  loading: boolean;
  assignmentsVersion: number;
}

export function useZoneAssignments(missionId: string | null): UseZoneAssignmentsResult {
  const { user } = useAuth();
  const [assignmentsByZoneId, setAssignmentsByZoneId] = useState<Map<string, ApiZoneAssignment[]>>(
    new Map()
  );
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  const refetch = useCallback(async () => {
    if (!missionId) {
      setAssignmentsByZoneId(new Map());
      setLoading(false);
      return;
    }

    setLoading(true);
    cancelledRef.current = false;

    try {
      const zones = await listZones(missionId);
      if (cancelledRef.current) return;

      const newMap = new Map<string, ApiZoneAssignment[]>();
      for (const zone of zones) {
        if (zone.assignments && zone.assignments.length > 0) {
          newMap.set(zone.id, zone.assignments);
        }
      }

      setAssignmentsByZoneId(newMap);
      setVersion((v) => v + 1);
    } catch (e) {
      if (!cancelledRef.current) {
        console.error('Failed to refetch zone assignments', e);
      }
    } finally {
      if (!cancelledRef.current) {
        setLoading(false);
      }
    }
  }, [missionId]);

  useEffect(() => {
    cancelledRef.current = false;
    void refetch();

    return () => {
      cancelledRef.current = true;
    };
  }, [refetch]);

  useEffect(() => {
    if (!missionId) return;

    const socket = getSocket();

    const onAssignmentsChanged = (msg: any) => {
      if (!msg || msg.missionId !== missionId) return;
      if (!msg.zoneId || !msg.assignments) return;

      setAssignmentsByZoneId((prev) => {
        const next = new Map(prev);
        if (msg.assignments.length > 0) {
          next.set(msg.zoneId, msg.assignments);
        } else {
          next.delete(msg.zoneId);
        }
        return next;
      });
    };

    const onAssignedToYou = (msg: any) => {
      if (!msg || msg.missionId !== missionId) return;
      if (!msg.zoneId) return;

      void refetch();
    };

    const onZonesRefetch = (msg: any) => {
      if (!msg || msg.missionId !== missionId) return;
      void refetch();
    };

    const onZoneDeleted = (msg: any) => {
      if (!msg.zoneId) return;
      setAssignmentsByZoneId((prev) => {
        const next = new Map(prev);
        next.delete(msg.zoneId);
        return next;
      });
    };

    socket.on('zone:assignments:changed', onAssignmentsChanged);
    socket.on('zone:assigned:you', onAssignedToYou);
    socket.on('mission:zones-refetch', onZonesRefetch);
    socket.on('zone:deleted', onZoneDeleted);

    return () => {
      socket.off('zone:assignments:changed', onAssignmentsChanged);
      socket.off('zone:assigned:you', onAssignedToYou);
      socket.off('mission:zones-refetch', onZonesRefetch);
      socket.off('zone:deleted', onZoneDeleted);
    };
  }, [missionId, refetch]);

  const myAssignedZoneIds = Array.from(assignmentsByZoneId.entries())
    .filter(([, assignments]) => assignments.some((a) => a.userId === user?.id))
    .map(([zoneId]) => zoneId);

  return {
    assignmentsByZoneId,
    myAssignedZoneIds,
    refetch,
    loading,
    assignmentsVersion: version,
  };
}
