import { IsInt, IsNotEmpty, IsOptional, IsUUID, Min, ValidateIf } from 'class-validator';

export class CreatorTargetDto {
  @IsUUID()
  @IsNotEmpty()
  creatorProfileId!: string;
}

export class UnfollowQueryDto {
  @IsUUID()
  @IsNotEmpty()
  creatorProfileId!: string;
}

export class EngagementListQueryDto {
  @IsOptional()
  cursor?: string;

  @IsOptional()
  limit?: number;
}

export class ClaimMissionDto {
  @ValidateIf((o) => o.milestoneDay == null)
  @IsUUID()
  @IsNotEmpty()
  missionProgressId?: string;

  @ValidateIf((o) => !o.missionProgressId)
  @IsInt()
  @Min(1)
  milestoneDay?: number;
}

export class RewardsQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}
