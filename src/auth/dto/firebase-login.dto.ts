import { IsString } from 'class-validator';

export class FirebaseLoginDto {
  @IsString()
  firebaseToken: string;
}
